//! Proves the baked-in device key path: russh -> forced qc-agent -> add/revoke.
//! cargo run --release --example embedprobe
use quotacards::{config, server};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let key = config::EMBED_KEY.expect("no embed key baked into this build");
    println!("embed key len: {}", key.len());
    println!("server::is_embed_key: {}", server::is_embed_key(key));
    let u = uuid::Uuid::new_v4().to_string();
    println!("probe {u}");
    let a = server::add_client(config::DEFAULT_HOST, config::DEFAULT_PORT, config::DEFAULT_USER, key, &u).await;
    println!("ADD: {a:?}");
    let r = server::remove_client(config::DEFAULT_HOST, config::DEFAULT_PORT, config::DEFAULT_USER, key, &u).await;
    println!("REVOKE: {r:?}");
    println!("DONE");
}
