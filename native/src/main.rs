//! 一条龙清单 · 手柄遥控 native messaging host
//!
//! 只做一件事：用 gilrs 读手柄，把「原始按键事件」通过 Chrome Native Messaging
//! 协议(4 字节小端长度前缀 + JSON)写到 stdout，发给扩展。
//! 所有映射 / 单双击判定 / 操作 B 站，都在扩展端完成——本程序不关心。
//!
//! 编译(免装 Visual Studio，见 native/README.md)：
//!     cargo xwin build --release
//! 产物：target/x86_64-pc-windows-msvc/release/osn-gamepad.exe

use std::io::{self, Read, Write};
use std::thread;
use std::time::Duration;

use gilrs::{EventType, Gilrs};

/// 按 Native Messaging 协议写一条消息到 stdout。
fn send(value: &serde_json::Value) {
    let text = value.to_string();
    let bytes = text.as_bytes();
    let mut out = io::stdout().lock();
    if out.write_all(&(bytes.len() as u32).to_le_bytes()).is_err() { return }
    if out.write_all(bytes).is_err() { return }
    let _ = out.flush();
}

fn main() {
    // 扩展断开端口时 stdin 会 EOF —— 起一个线程监听，EOF 即退出，避免残留进程。
    thread::spawn(|| {
        let mut buf = [0u8; 1024];
        let mut stdin = io::stdin();
        loop {
            match stdin.read(&mut buf) {
                Ok(0) | Err(_) => std::process::exit(0),
                Ok(_) => {} // 扩展发来的内容暂不处理
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

    loop {
        while let Some(ev) = gilrs.next_event() {
            let name = gilrs
                .connected_gamepad(ev.id)
                .map(|g| g.name().to_string())
                .unwrap_or_default();

            match ev.event {
                EventType::ButtonPressed(button, code) => send(&serde_json::json!({
                    "type": "button",
                    "state": "down",
                    "button": format!("{:?}", button),
                    "code": code.to_string(),
                    "gamepad": name,
                })),
                EventType::ButtonReleased(button, code) => send(&serde_json::json!({
                    "type": "button",
                    "state": "up",
                    "button": format!("{:?}", button),
                    "code": code.to_string(),
                    "gamepad": name,
                })),
                EventType::Connected => send(&serde_json::json!({ "type": "connected", "gamepad": name })),
                EventType::Disconnected => send(&serde_json::json!({ "type": "disconnected", "gamepad": name })),
                _ => {}
            }
        }
        // 轮询间隔：2ms 足够跟手，CPU 占用极低
        thread::sleep(Duration::from_millis(2));
    }
}
