//! Chromium's native-messaging host for the box's active-tab extension: started by Chromium,
//! it records the page in front until the browser closes the port. See `box_host::active_tab`.

fn main() {
    let path = std::path::Path::new(box_host::active_tab::ACTIVE_TAB_FILE);
    if let Err(error) = box_host::active_tab::serve(&mut std::io::stdin().lock(), path) {
        eprintln!("box-active-tab: {error}");
        std::process::exit(1);
    }
}
