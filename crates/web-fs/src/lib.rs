pub mod error;
pub mod metadata;
pub mod parse;
pub mod path_util;

#[cfg(target_family = "wasm")]
mod opfs;
#[cfg(not(target_family = "wasm"))]
mod stub;

#[cfg(target_family = "wasm")]
use opfs as imp;
#[cfg(not(target_family = "wasm"))]
use stub as imp;

pub use error::{FsError, Result};
pub use metadata::{DirEntry, EntryKind, Metadata};

pub async fn exists(path: impl AsRef<std::path::Path>) -> bool {
    imp::exists(path).await
}

pub async fn stat(path: impl AsRef<std::path::Path>) -> Result<Metadata> {
    imp::stat(path).await
}

pub async fn list(path: impl AsRef<std::path::Path>) -> Result<Vec<DirEntry>> {
    imp::list(path).await
}

pub async fn mkdir(path: impl AsRef<std::path::Path>) -> Result<()> {
    imp::mkdir(path).await
}

pub async fn delete(path: impl AsRef<std::path::Path>) -> Result<()> {
    imp::delete(path).await
}

pub async fn copy(
    from: impl AsRef<std::path::Path>,
    to: impl AsRef<std::path::Path>,
) -> Result<()> {
    imp::copy(from, to).await
}

pub async fn rename(
    from: impl AsRef<std::path::Path>,
    to: impl AsRef<std::path::Path>,
) -> Result<()> {
    imp::rename(from, to).await
}

pub async fn read(path: impl AsRef<std::path::Path>) -> Result<Vec<u8>> {
    imp::read(path).await
}

pub async fn read_text(path: impl AsRef<std::path::Path>) -> Result<String> {
    imp::read_text(path).await
}

pub async fn read_base64(path: impl AsRef<std::path::Path>) -> Result<String> {
    imp::read_base64(path).await
}

pub async fn read_range(
    path: impl AsRef<std::path::Path>,
    offset: u64,
    len: usize,
) -> Result<Vec<u8>> {
    imp::read_range(path, offset, len).await
}

pub async fn write(path: impl AsRef<std::path::Path>, data: impl AsRef<[u8]>) -> Result<()> {
    imp::write(path, data).await
}

pub async fn write_text(path: impl AsRef<std::path::Path>, text: impl AsRef<str>) -> Result<()> {
    imp::write_text(path, text).await
}

pub async fn write_base64(path: impl AsRef<std::path::Path>, b64: impl AsRef<str>) -> Result<()> {
    imp::write_base64(path, b64).await
}

pub async fn append(path: impl AsRef<std::path::Path>, data: impl AsRef<[u8]>) -> Result<()> {
    imp::append(path, data).await
}

pub async fn append_text(path: impl AsRef<std::path::Path>, text: impl AsRef<str>) -> Result<()> {
    imp::append_text(path, text).await
}

pub async fn append_base64(path: impl AsRef<std::path::Path>, b64: impl AsRef<str>) -> Result<()> {
    imp::append_base64(path, b64).await
}

pub async fn update(
    path: impl AsRef<std::path::Path>,
    offset: u64,
    data: impl AsRef<[u8]>,
) -> Result<()> {
    imp::update(path, offset, data).await
}

pub async fn hash(path: impl AsRef<std::path::Path>, algo: &str) -> Result<String> {
    imp::hash(path, algo).await
}

pub async fn parse_csv(path: impl AsRef<std::path::Path>) -> Result<String> {
    let bytes = imp::read(path).await?;
    parse::parse_csv_bytes(&bytes)
}

pub async fn parse_zip(path: impl AsRef<std::path::Path>) -> Result<String> {
    let bytes = imp::read(path).await?;
    parse::parse_zip_bytes(&bytes)
}

pub async fn parse_xlsx(path: impl AsRef<std::path::Path>) -> Result<String> {
    let bytes = imp::read(path).await?;
    parse::parse_xlsx_bytes(&bytes)
}

pub async fn parse_pdf(path: impl AsRef<std::path::Path>) -> Result<String> {
    let bytes = imp::read(path).await?;
    parse::parse_pdf_bytes(&bytes)
}
