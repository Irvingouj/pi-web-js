use crate::{DirEntry, FsError, Metadata, Result};
use std::path::Path;

fn not_supported<T>() -> Result<T> {
    Err(FsError::Io("OPFS is only available on WASM targets".into()))
}

pub async fn exists(_path: impl AsRef<Path>) -> bool {
    false
}
pub async fn stat(_path: impl AsRef<Path>) -> Result<Metadata> {
    not_supported()
}
pub async fn list(_path: impl AsRef<Path>) -> Result<Vec<DirEntry>> {
    not_supported()
}
pub async fn mkdir(_path: impl AsRef<Path>) -> Result<()> {
    not_supported()
}
pub async fn delete(_path: impl AsRef<Path>) -> Result<()> {
    not_supported()
}
pub async fn copy(_from: impl AsRef<Path>, _to: impl AsRef<Path>) -> Result<()> {
    not_supported()
}
pub async fn rename(_from: impl AsRef<Path>, _to: impl AsRef<Path>) -> Result<()> {
    not_supported()
}
pub async fn read(_path: impl AsRef<Path>) -> Result<Vec<u8>> {
    not_supported()
}
pub async fn read_text(_path: impl AsRef<Path>) -> Result<String> {
    not_supported()
}
pub async fn read_base64(_path: impl AsRef<Path>) -> Result<String> {
    not_supported()
}
pub async fn read_range(_path: impl AsRef<Path>, _offset: u64, _len: usize) -> Result<Vec<u8>> {
    not_supported()
}
pub async fn write(_path: impl AsRef<Path>, _data: impl AsRef<[u8]>) -> Result<()> {
    not_supported()
}
pub async fn write_text(_path: impl AsRef<Path>, _text: impl AsRef<str>) -> Result<()> {
    not_supported()
}
pub async fn write_base64(_path: impl AsRef<Path>, _b64: impl AsRef<str>) -> Result<()> {
    not_supported()
}
pub async fn append(_path: impl AsRef<Path>, _data: impl AsRef<[u8]>) -> Result<()> {
    not_supported()
}
pub async fn append_text(_path: impl AsRef<Path>, _text: impl AsRef<str>) -> Result<()> {
    not_supported()
}
pub async fn append_base64(_path: impl AsRef<Path>, _b64: impl AsRef<str>) -> Result<()> {
    not_supported()
}
pub async fn update(_path: impl AsRef<Path>, _offset: u64, _data: impl AsRef<[u8]>) -> Result<()> {
    not_supported()
}
pub async fn hash(_path: impl AsRef<Path>, _algo: &str) -> Result<String> {
    not_supported()
}
