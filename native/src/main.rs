//! 一条龙清单 · 手柄/键盘遥控 native messaging host
//!
//! 三路读取并去重，把「原始按键事件」通过 Native Messaging(4 字节小端长度 + JSON)
//! 写到 stdout 发给扩展；从 stdin 收扩展下发的配置(键盘白名单 / 捕获开关)。
//!   - gilrs：DirectInput/HID 手柄(桌面物理手柄)
//!   - XInput：轮询共享、不抢焦点——玩游戏时(手柄虚拟成 Xbox)后台也能读
//!   - 键盘：GetAsyncKeyState 轮询系统级键状态，同样不抢焦点；**默认只查扩展下发的
//!     白名单键**(不记录其他按键)，仅「捕获绑定」时临时扫全部键
//! 所有映射 / 单双击判定 / 操作 B 站都在扩展端完成。
//!
//! 编译：cargo xwin build --release(见 native/README.md)

use std::collections::{HashMap, HashSet};
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gilrs::{EventType, Gilrs};
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// 按 Native Messaging 协议写一条消息到 stdout。
fn send(value: &serde_json::Value) {
    let text = value.to_string();
    let bytes = text.as_bytes();
    let mut out = io::stdout().lock();
    if out.write_all(&(bytes.len() as u32).to_le_bytes()).is_err() { return }
    if out.write_all(bytes).is_err() { return }
    let _ = out.flush();
}

/// 去重发送:多路可能读到同一输入，60ms 内同一 (button,state) 只发一次。
fn emit(button: &str, state: &str, code: &str, gamepad: &str, last: &mut HashMap<String, u128>, now: u128) {
    let key = format!("{button}|{state}");
    if let Some(&t) = last.get(&key) {
        if now.saturating_sub(t) < 60 { return }
    }
    last.insert(key, now);
    send(&serde_json::json!({
        "type": "button", "state": state, "button": button, "code": code, "gamepad": gamepad
    }));
}

/// XInput 按钮位 → 与 gilrs 一致的名字。
const XI_BUTTONS: &[(u16, &str)] = &[
    (0x0001, "DPadUp"), (0x0002, "DPadDown"), (0x0004, "DPadLeft"), (0x0008, "DPadRight"),
    (0x0010, "Start"), (0x0020, "Select"),
    (0x0040, "LeftThumb"), (0x0080, "RightThumb"),
    (0x0100, "LeftTrigger"), (0x0200, "RightTrigger"),
    (0x1000, "South"), (0x2000, "East"), (0x4000, "West"), (0x8000, "North"),
];

fn poll_xinput(prev: &mut [u16; 4], last: &mut HashMap<String, u128>, now: u128) {
    for i in 0u32..4 {
        let mut st = XINPUT_STATE::default();
        let connected = unsafe { XInputGetState(i, &mut st) } == 0;
        if !connected {
            prev[i as usize] = 0;
            continue;
        }
        let buttons = st.Gamepad.wButtons.0;
        let changed = buttons ^ prev[i as usize];
        if changed != 0 {
            let gp = format!("XInput Controller {i}");
            for &(bit, name) in XI_BUTTONS {
                if changed & bit != 0 {
                    let state = if buttons & bit != 0 { "down" } else { "up" };
                    emit(name, state, &format!("XInput({bit:#06x})"), &gp, last, now);
                }
            }
            prev[i as usize] = buttons;
        }
    }
}

/// 扩展下发的键盘配置。
#[derive(Default)]
struct KbConfig {
    whitelist: HashSet<i32>,
    capture: bool,
}

/// 键盘:GetAsyncKeyState 轮询。非捕获只查白名单,捕获时扫常用键范围。
/// button 名用 "Key:{vk}"(十进制虚拟键码),扩展端据此绑定。
fn poll_keyboard(cfg: &Arc<Mutex<KbConfig>>, prev: &mut HashSet<i32>, last: &mut HashMap<String, u128>, now: u128) {
    let (mut keys, capture): (Vec<i32>, bool) = {
        let c = cfg.lock().unwrap();
        if c.capture {
            ((0x08..=0xFE).collect(), true)
        } else {
            (c.whitelist.iter().copied().collect(), false)
        }
    };
    // 非捕获时仍要给"上一帧按着、现在移出白名单"的键补一个 up，避免卡住
    if !capture {
        for &vk in prev.iter() {
            if !keys.contains(&vk) { keys.push(vk); }
        }
    }
    for vk in keys {
        let down = unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000 != 0;
        let was = prev.contains(&vk);
        if down && !was {
            prev.insert(vk);
            emit(&format!("Key:{vk}"), "down", &format!("VK({vk})"), "Keyboard", last, now);
        } else if !down && was {
            prev.remove(&vk);
            emit(&format!("Key:{vk}"), "up", &format!("VK({vk})"), "Keyboard", last, now);
        }
    }
}

fn main() {
    let cfg = Arc::new(Mutex::new(KbConfig::default()));

    // stdin:读 Native Messaging 帧 → 解析配置(键盘白名单/捕获开关);EOF 退出。
    {
        let cfg = cfg.clone();
        thread::spawn(move || {
            let mut stdin = io::stdin();
            loop {
                let mut len_buf = [0u8; 4];
                if stdin.read_exact(&mut len_buf).is_err() { std::process::exit(0); }
                let len = u32::from_le_bytes(len_buf) as usize;
                if len == 0 || len > 1_000_000 { continue; }
                let mut buf = vec![0u8; len];
                if stdin.read_exact(&mut buf).is_err() { std::process::exit(0); }
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf) {
                    let mut c = cfg.lock().unwrap();
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("kb-config") => {
                            if let Some(arr) = v.get("keys").and_then(|k| k.as_array()) {
                                c.whitelist = arr.iter().filter_map(|x| x.as_i64().map(|n| n as i32)).collect();
                            }
                        }
                        Some("capture") => {
                            c.capture = v.get("on").and_then(|o| o.as_bool()).unwrap_or(false);
                        }
                        _ => {}
                    }
                }
            }
        });
    }

    let mut gilrs = match Gilrs::new() {
        Ok(g) => g,
        Err(e) => {
            send(&serde_json::json!({ "type": "error", "message": e.to_string() }));
            return;
        }
    };

    send(&serde_json::json!({ "type": "ready" }));

    let mut last: HashMap<String, u128> = HashMap::new();
    let mut xi_prev = [0u16; 4];
    let mut kb_prev: HashSet<i32> = HashSet::new();
    let mut last_ping = now_ms();

    loop {
        let now = now_ms();

        // 心跳:定期发消息让 MV3 service worker 保活(否则空闲被回收 → port 断 → 本进程收到 EOF 退出)
        if now.saturating_sub(last_ping) >= 20_000 {
            last_ping = now;
            send(&serde_json::json!({ "type": "ping" }));
        }

        while let Some(ev) = gilrs.next_event() {
            let name = gilrs.connected_gamepad(ev.id).map(|g| g.name().to_string()).unwrap_or_default();
            match ev.event {
                EventType::ButtonPressed(button, code) => emit(&format!("{button:?}"), "down", &code.to_string(), &name, &mut last, now),
                EventType::ButtonReleased(button, code) => emit(&format!("{button:?}"), "up", &code.to_string(), &name, &mut last, now),
                EventType::Connected => send(&serde_json::json!({ "type": "connected", "gamepad": name })),
                EventType::Disconnected => send(&serde_json::json!({ "type": "disconnected", "gamepad": name })),
                _ => {}
            }
        }

        poll_xinput(&mut xi_prev, &mut last, now);
        poll_keyboard(&cfg, &mut kb_prev, &mut last, now);

        thread::sleep(Duration::from_millis(5));
    }
}
