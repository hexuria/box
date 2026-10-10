//! Chromium's native-messaging host for the box's active-tab extension: started by Chromium,
//! it records the page in front until the browser closes the port. See `box_host::active_tab`.

fn main() {
    // Chromium starts this host, so its DISPLAY is the screen that Chromium is on.
    let display = std::env::var("DISPLAY").ok();
    let path = box_host::active_tab::file_for(display.as_deref());
    if let Err(error) = box_host::active_tab::serve(&mut std::io::stdin().lock(), &path) {
        eprintln!("box-active-tab: {error}");
        std::process::exit(1);
    }
}
