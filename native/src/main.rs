//! 一条龙清单 · 手柄遥控 native messaging host
//!
//! gilrs(DirectInput/HID) + XInput 双路读手柄并去重，把「原始按键事件」通过
//! Native Messaging(4 字节小端长度 + JSON)写到 stdout 发给扩展。
//! 所有映射 / 单双击判定 / 操作 B 站都在扩展端完成。
//!
//! ⚠️ 重要:Switch Pro / DualSense 等「非 XInput」手柄,玩游戏时前台游戏会独占
//! DirectInput/HID,后台读不到。需用 BetterJoy / Steam Input 把它虚拟成 Xbox(XInput),
//! XInput 是多进程共享、不抢焦点的,后台才能在游戏里也读到。详见 native/README.md。
//!
//! 编译:cargo xwin build --release(见 native/README.md)

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gilrs::{EventType, Gilrs};
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

/// 去重发送:gilrs 与 XInput 可能读到同一手柄,60ms 内同一 (button,state) 只发一次。
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

/// XInput 按钮位 → 与 gilrs 一致的名字(默认绑定按名字匹配,两路通用)。
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

fn main() {
    // 扩展断开端口 → stdin EOF → 退出
    thread::spawn(|| {
        let mut buf = [0u8; 1024];
        let mut stdin = io::stdin();
        loop {
            match stdin.read(&mut buf) {
                Ok(0) | Err(_) => std::process::exit(0),
                Ok(_) => {}
            }
        }
    });

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

    loop {
        let now = now_ms();

        // gilrs（DirectInput/HID,适合桌面物理手柄)
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

        // XInput（轮询共享,玩游戏时后台也能读到虚拟 Xbox)
        poll_xinput(&mut xi_prev, &mut last, now);

        thread::sleep(Duration::from_millis(5));
    }
}
