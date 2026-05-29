use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    File, FileSystemCreateWritableOptions, FileSystemDirectoryHandle, FileSystemFileHandle,
    FileSystemGetDirectoryOptions, FileSystemGetFileOptions, FileSystemHandleKind,
    FileSystemRemoveOptions, FileSystemWritableFileStream, StorageManager,
};

use crate::{DirEntry, EntryKind, FsError, Metadata, Result};

fn js_err_to_fs_err(err: &JsValue) -> FsError {
    let name = js_sys::Reflect::get(err, &"name".into())
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_default();
    let message = js_sys::Reflect::get(err, &"message".into())
        .ok()
        .and_then(|v| v.as_string())
        .unwrap_or_else(|| format!("{:?}", err));

    match name.as_str() {
        "NotFoundError" => FsError::NotFound,
        "NoModificationAllowedError" => FsError::PermissionDenied,
        "SecurityError" => FsError::PermissionDenied,
        "QuotaExceededError" => FsError::OutOfQuota,
        "TypeMismatchError" => FsError::NotFile,
        "InvalidStateError" => FsError::Io(message),
        _ => FsError::Io(message),
    }
}

async fn get_storage_manager() -> Result<StorageManager> {
    let global = js_sys::global();
    let navigator = js_sys::Reflect::get(&global, &"navigator".into())
        .map_err(|_| FsError::Io("navigator not available".into()))?;
    let storage = js_sys::Reflect::get(&navigator, &"storage".into())
        .map_err(|_| FsError::Io("storage not available".into()))?;
    storage
        .dyn_into::<StorageManager>()
        .map_err(|_| FsError::Io("StorageManager not available".into()))
}

async fn get_root() -> Result<FileSystemDirectoryHandle> {
    let storage_manager = get_storage_manager().await?;
    let promise = storage_manager.get_directory();
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;
    result
        .dyn_into::<FileSystemDirectoryHandle>()
        .map_err(|_| FsError::Io("invalid directory handle".into()))
}

fn path_parts(path: &std::path::Path) -> Result<Vec<String>> {
    if !path.has_root() {
        return Err(FsError::InvalidPath);
    }
    let mut parts = Vec::new();
    for comp in path.components() {
        match comp {
            std::path::Component::RootDir => {}
            std::path::Component::Normal(s) => {
                let s = s.to_str().ok_or(FsError::InvalidPath)?;
                if s == ".." {
                    return Err(FsError::InvalidPath);
                }
                if s == "." || s.is_empty() {
                    continue;
                }
                parts.push(s.to_string());
            }
            _ => return Err(FsError::InvalidPath),
        }
    }
    Ok(parts)
}

async fn resolve_dir(path: &std::path::Path) -> Result<FileSystemDirectoryHandle> {
    let parts = path_parts(path)?;
    let mut current = get_root().await?;
    for part in parts {
        let promise = current.get_directory_handle(&part);
        let result = JsFuture::from(promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?;
        current = result
            .dyn_into::<FileSystemDirectoryHandle>()
            .map_err(|_| FsError::NotDirectory)?;
    }
    Ok(current)
}

async fn resolve_dir_create(path: &std::path::Path) -> Result<FileSystemDirectoryHandle> {
    let parts = path_parts(path)?;
    let mut current = get_root().await?;
    for part in parts {
        let opts = FileSystemGetDirectoryOptions::new();
        opts.set_create(true);
        let promise = current.get_directory_handle_with_options(&part, &opts);
        let result = JsFuture::from(promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?;
        current = result
            .dyn_into::<FileSystemDirectoryHandle>()
            .map_err(|_| FsError::Io("invalid directory handle".into()))?;
    }
    Ok(current)
}

async fn resolve_parent_and_name(
    path: &std::path::Path,
) -> Result<(FileSystemDirectoryHandle, String)> {
    let parts = path_parts(path)?;
    if parts.is_empty() {
        return Err(FsError::InvalidPath);
    }
    let name = parts.last().unwrap().clone();
    let parent_parts = &parts[..parts.len() - 1];
    let mut current = get_root().await?;
    for part in parent_parts {
        let promise = current.get_directory_handle(&part);
        let result = JsFuture::from(promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?;
        current = result
            .dyn_into::<FileSystemDirectoryHandle>()
            .map_err(|_| FsError::NotDirectory)?;
    }
    Ok((current, name))
}

async fn resolve_file(path: &std::path::Path) -> Result<FileSystemFileHandle> {
    let (parent, name) = resolve_parent_and_name(path).await?;
    let opts = FileSystemGetFileOptions::new();
    let promise = parent.get_file_handle_with_options(&name, &opts);
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;
    result
        .dyn_into::<FileSystemFileHandle>()
        .map_err(|_| FsError::NotFile)
}

async fn resolve_file_create(path: &std::path::Path) -> Result<FileSystemFileHandle> {
    let parts = path_parts(path)?;
    if parts.is_empty() {
        return Err(FsError::InvalidPath);
    }
    let name = parts.last().unwrap().clone();
    let parent_parts = &parts[..parts.len() - 1];

    let mut current = get_root().await?;
    for part in parent_parts {
        let opts = FileSystemGetDirectoryOptions::new();
        opts.set_create(true);
        let promise = current.get_directory_handle_with_options(&part, &opts);
        let result = JsFuture::from(promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?;
        current = result
            .dyn_into::<FileSystemDirectoryHandle>()
            .map_err(|_| FsError::Io("invalid directory handle".into()))?;
    }

    let opts = FileSystemGetFileOptions::new();
    opts.set_create(true);
    let promise = current.get_file_handle_with_options(&name, &opts);
    let result = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;
    result
        .dyn_into::<FileSystemFileHandle>()
        .map_err(|_| FsError::Io("invalid file handle".into()))
}

async fn get_file_size(handle: &FileSystemFileHandle) -> Result<u64> {
    let promise = handle.get_file();
    let file = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?
        .dyn_into::<File>()
        .map_err(|_| FsError::Io("invalid file".into()))?;
    Ok(file.size() as u64)
}

async fn write_to_handle(
    handle: &FileSystemFileHandle,
    data: &[u8],
    offset: Option<u64>,
) -> Result<()> {
    let opts = FileSystemCreateWritableOptions::new();
    if offset.is_some() {
        opts.set_keep_existing_data(true);
    }
    let promise = if offset.is_some() {
        handle.create_writable_with_options(&opts)
    } else {
        handle.create_writable()
    };
    let stream = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?
        .dyn_into::<FileSystemWritableFileStream>()
        .map_err(|_| FsError::Io("invalid writable stream".into()))?;

    if let Some(off) = offset {
        let seek_promise = stream
            .seek_with_f64(off as f64)
            .map_err(|e| js_err_to_fs_err(&e))?;
        JsFuture::from(seek_promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?;
    }

    let write_promise = stream
        .write_with_u8_array(data)
        .map_err(|e| js_err_to_fs_err(&e))?;
    JsFuture::from(write_promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;

    let close_promise = stream.close();
    JsFuture::from(close_promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;

    Ok(())
}

// ─── Public API ─────────────────────────────────────────────────

pub async fn exists(path: impl AsRef<std::path::Path>) -> bool {
    stat(path).await.is_ok()
}

pub async fn stat(path: impl AsRef<std::path::Path>) -> Result<Metadata> {
    let path = path.as_ref();
    let path_str = path.to_string_lossy().to_string();

    // Try file first
    if let Ok(handle) = resolve_file(path).await {
        let promise = handle.get_file();
        let file = JsFuture::from(promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?
            .dyn_into::<File>()
            .map_err(|_| FsError::Io("invalid file".into()))?;
        return Ok(Metadata {
            path: path_str,
            name: file.name(),
            kind: EntryKind::File,
            size: file.size() as u64,
            mime: None,
            created_at: None,
            modified_at: Some(file.last_modified() as u64),
        });
    }

    // Try directory
    let dir = resolve_dir(path).await?;
    Ok(Metadata {
        path: path_str,
        name: dir.name(),
        kind: EntryKind::Directory,
        size: 0,
        mime: None,
        created_at: None,
        modified_at: None,
    })
}

pub async fn list(path: impl AsRef<std::path::Path>) -> Result<Vec<DirEntry>> {
    let dir = resolve_dir(path.as_ref()).await?;
    let entries_iter = dir.entries();
    let mut entries = Vec::new();

    loop {
        let promise = entries_iter.next().map_err(|e| js_err_to_fs_err(&e))?;
        let result = JsFuture::from(promise)
            .await
            .map_err(|e| js_err_to_fs_err(&e))?;
        let done = js_sys::Reflect::get(&result, &"done".into())
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        if done {
            break;
        }
        let value = js_sys::Reflect::get(&result, &"value".into())
            .map_err(|_| FsError::Io("invalid iterator value".into()))?;
        let arr = value
            .dyn_into::<js_sys::Array>()
            .map_err(|_| FsError::Io("invalid entry array".into()))?;
        let name = arr.get(0).as_string().unwrap_or_default();
        let handle = arr
            .get(1)
            .dyn_into::<web_sys::FileSystemHandle>()
            .map_err(|_| FsError::Io("invalid handle".into()))?;
        let kind = match handle.kind() {
            FileSystemHandleKind::File => EntryKind::File,
            FileSystemHandleKind::Directory => EntryKind::Directory,
            _ => EntryKind::File,
        };
        entries.push(DirEntry { name, kind });
    }

    Ok(entries)
}

pub async fn mkdir(path: impl AsRef<std::path::Path>) -> Result<()> {
    resolve_dir_create(path.as_ref()).await.map(|_| ())
}

pub async fn delete(path: impl AsRef<std::path::Path>) -> Result<()> {
    let path = path.as_ref();
    let (parent, name) = resolve_parent_and_name(path).await?;
    let opts = FileSystemRemoveOptions::new();
    opts.set_recursive(true);
    let promise = parent.remove_entry_with_options(&name, &opts);
    JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;
    Ok(())
}

pub async fn copy(
    from: impl AsRef<std::path::Path>,
    to: impl AsRef<std::path::Path>,
) -> Result<()> {
    let bytes = read(from).await?;
    write(to, &bytes).await?;
    Ok(())
}

pub async fn rename(
    from: impl AsRef<std::path::Path>,
    to: impl AsRef<std::path::Path>,
) -> Result<()> {
    let from_path = from.as_ref().to_path_buf();
    let bytes = read(&from_path).await?;
    write(to, &bytes).await?;
    delete(&from_path).await?;
    Ok(())
}

pub async fn read(path: impl AsRef<std::path::Path>) -> Result<Vec<u8>> {
    let handle = resolve_file(path.as_ref()).await?;
    let promise = handle.get_file();
    let file = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?
        .dyn_into::<File>()
        .map_err(|_| FsError::Io("invalid file".into()))?;
    let ab_promise = file.array_buffer();
    let buf = JsFuture::from(ab_promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;
    let array = js_sys::Uint8Array::new(&buf);
    let mut bytes = vec![0u8; array.length() as usize];
    array.copy_to(&mut bytes);
    Ok(bytes)
}

pub async fn read_text(path: impl AsRef<std::path::Path>) -> Result<String> {
    let handle = resolve_file(path.as_ref()).await?;
    let promise = handle.get_file();
    let file = JsFuture::from(promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?
        .dyn_into::<File>()
        .map_err(|_| FsError::Io("invalid file".into()))?;
    let text_promise = file.text();
    let text_js = JsFuture::from(text_promise)
        .await
        .map_err(|e| js_err_to_fs_err(&e))?;
    Ok(text_js.as_string().unwrap_or_default())
}

pub async fn read_base64(path: impl AsRef<std::path::Path>) -> Result<String> {
    let bytes = read(path).await?;
    Ok(data_encoding::BASE64.encode(&bytes))
}

pub async fn read_range(
    path: impl AsRef<std::path::Path>,
    offset: u64,
    len: usize,
) -> Result<Vec<u8>> {
    let bytes = read(path).await?;
    let start = offset as usize;
    if start >= bytes.len() {
        return Ok(Vec::new());
    }
    let end = (start + len).min(bytes.len());
    Ok(bytes[start..end].to_vec())
}

pub async fn write(path: impl AsRef<std::path::Path>, data: impl AsRef<[u8]>) -> Result<()> {
    let handle = resolve_file_create(path.as_ref()).await?;
    write_to_handle(&handle, data.as_ref(), None).await
}

pub async fn write_text(path: impl AsRef<std::path::Path>, text: impl AsRef<str>) -> Result<()> {
    write(path, text.as_ref().as_bytes()).await
}

pub async fn write_base64(path: impl AsRef<std::path::Path>, b64: impl AsRef<str>) -> Result<()> {
    let bytes = data_encoding::BASE64
        .decode(b64.as_ref().as_bytes())
        .map_err(|_| FsError::InvalidEncoding)?;
    write(path, &bytes).await
}

pub async fn append(path: impl AsRef<std::path::Path>, data: impl AsRef<[u8]>) -> Result<()> {
    let path = path.as_ref();
    let handle = match resolve_file(path).await {
        Ok(h) => h,
        Err(FsError::NotFound) => resolve_file_create(path).await?,
        Err(e) => return Err(e),
    };
    let size = get_file_size(&handle).await?;
    write_to_handle(&handle, data.as_ref(), Some(size)).await
}

pub async fn append_text(path: impl AsRef<std::path::Path>, text: impl AsRef<str>) -> Result<()> {
    append(path, text.as_ref().as_bytes()).await
}

pub async fn append_base64(path: impl AsRef<std::path::Path>, b64: impl AsRef<str>) -> Result<()> {
    let bytes = data_encoding::BASE64
        .decode(b64.as_ref().as_bytes())
        .map_err(|_| FsError::InvalidEncoding)?;
    append(path, &bytes).await
}

pub async fn update(
    path: impl AsRef<std::path::Path>,
    offset: u64,
    data: impl AsRef<[u8]>,
) -> Result<()> {
    let handle = resolve_file(path.as_ref()).await?;
    write_to_handle(&handle, data.as_ref(), Some(offset)).await
}

pub async fn hash(path: impl AsRef<std::path::Path>, algo: &str) -> Result<String> {
    let bytes = read(path).await?;
    let hex = match algo.to_lowercase().as_str() {
        "sha256" => {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            hasher
                .finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect()
        }
        "sha1" => {
            use sha1::{Digest, Sha1};
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            hasher
                .finalize()
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect()
        }
        _ => return Err(FsError::InvalidEncoding),
    };
    Ok(hex)
}
