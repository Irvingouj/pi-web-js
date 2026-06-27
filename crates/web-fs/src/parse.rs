//! Pure-compute parsers for common structured file formats.
//!
//! Each `parse_<fmt>_bytes` is a synchronous pure function over `&[u8]`,
//! independent of OPFS — so they are unit-testable on the host (stub impl)
//! without touching the filesystem.

#![allow(dead_code)]

use crate::error::{FsError, Result};
use std::io::Cursor;

pub fn parse_csv_bytes(bytes: &[u8]) -> Result<String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(Cursor::new(bytes));
    let mut rows: Vec<Vec<String>> = Vec::new();
    for record in reader.records() {
        let row = record
            .map_err(|e| FsError::Parse {
                format: "csv",
                detail: e.to_string(),
            })?
            .iter()
            .map(String::from)
            .collect();
        rows.push(row);
    }
    serde_json::to_string(&rows).map_err(|e| FsError::Parse {
        format: "csv",
        detail: e.to_string(),
    })
}

/// Parse ZIP bytes into JSON `{ "entries": [{ name, size, compressed_size }] }`.
/// Lists entries only — content extraction is a future zip.extract action.
pub fn parse_zip_bytes(bytes: &[u8]) -> Result<String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| FsError::Parse {
        format: "zip",
        detail: e.to_string(),
    })?;
    let mut entries: Vec<serde_json::Value> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| FsError::Parse {
            format: "zip",
            detail: e.to_string(),
        })?;
        entries.push(serde_json::json!({
            "name": entry.name().to_string(),
            "size": entry.size(),
            "compressed_size": entry.compressed_size(),
        }));
    }
    serde_json::to_string(&serde_json::json!({ "entries": entries })).map_err(|e| FsError::Parse {
        format: "zip",
        detail: e.to_string(),
    })
}

/// Parse XLSX bytes into JSON `{ "sheets": { "<name>": [[cell,...],...] } }`.
/// Numbers stay as JSON numbers, strings as strings, empty cells as null.
pub fn parse_xlsx_bytes(bytes: &[u8]) -> Result<String> {
    use calamine::Reader;
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mut book: calamine::Sheets<_> =
        calamine::open_workbook_auto_from_rs(cursor).map_err(|e| FsError::Parse {
            format: "xlsx",
            detail: e.to_string(),
        })?;
    let names = book.sheet_names();
    let mut sheets = serde_json::Map::new();
    for name in names {
        let range = book.worksheet_range(&name).map_err(|e| FsError::Parse {
            format: "xlsx",
            detail: e.to_string(),
        })?;
        let mut rows: Vec<serde_json::Value> = Vec::new();
        for row in range.rows() {
            let cells: Vec<serde_json::Value> = row
                .iter()
                .map(|d| match d {
                    calamine::Data::Int(i) => serde_json::Value::from(*i),
                    calamine::Data::Float(f) => serde_json::Number::from_f64(*f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null),
                    calamine::Data::String(s) => serde_json::Value::String(s.clone()),
                    calamine::Data::Bool(b) => serde_json::Value::Bool(*b),
                    calamine::Data::DateTimeIso(s) | calamine::Data::DurationIso(s) => {
                        serde_json::Value::String(s.clone())
                    }
                    calamine::Data::Empty
                    | calamine::Data::DateTime(_)
                    | calamine::Data::Error(_) => serde_json::Value::Null,
                })
                .collect();
            rows.push(serde_json::Value::Array(cells));
        }
        sheets.insert(name, serde_json::Value::Array(rows));
    }
    serde_json::to_string(&serde_json::json!({ "sheets": serde_json::Value::Object(sheets) }))
        .map_err(|e| FsError::Parse {
            format: "xlsx",
            detail: e.to_string(),
        })
}

/// Parse PDF bytes into JSON `{ "pages": ["",...], "text": "<concatenated>" }`.
/// Per-page extraction failures are tolerated (empty string appended, not fatal).
pub fn parse_pdf_bytes(bytes: &[u8]) -> Result<String> {
    let pdf = pdfplumber::Pdf::open(bytes, None).map_err(|e| FsError::Parse {
        format: "pdf",
        detail: e.to_string(),
    })?;
    let mut pages: Vec<String> = Vec::new();
    for page_result in pdf.pages_iter() {
        let text = match page_result {
            Ok(page) => page.extract_text(&pdfplumber::TextOptions::default()),
            Err(_) => String::new(),
        };
        pages.push(text);
    }
    let combined = pages.join("");
    serde_json::to_string(&serde_json::json!({ "pages": pages, "text": combined })).map_err(|e| {
        FsError::Parse {
            format: "pdf",
            detail: e.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_csv_returns_rows_as_arrays_of_strings() {
        let json = parse_csv_bytes(b"a,b\n1,2").unwrap();
        assert_eq!(json, r#"[["a","b"],["1","2"]]"#);
    }

    #[test]
    fn parse_zip_lists_entries() {
        use std::io::{Cursor, Write};
        use zip::write::SimpleFileOptions;
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zw = zip::ZipWriter::new(&mut buf);
            zw.start_file("hello.txt", SimpleFileOptions::default())
                .unwrap();
            zw.write_all(b"hi").unwrap();
        }
        let json = parse_zip_bytes(&buf.into_inner()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(
            v["entries"][0]["name"],
            serde_json::Value::String("hello.txt".to_string())
        );
    }

    #[test]
    fn parse_xlsx_reads_sheets() {
        let mut wb = rust_xlsxwriter::Workbook::new();
        let ws = wb.add_worksheet();
        ws.write(0, 0, "hello").unwrap();
        let bytes = wb.save_to_buffer().unwrap();
        let json = parse_xlsx_bytes(&bytes).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v["sheets"].is_object(), "sheets must be an object");
        let sheets = v["sheets"].as_object().unwrap();
        assert!(!sheets.is_empty(), "at least one sheet");
    }

    // ─── Real-world fixtures (downloaded/generated from real sources) ──────
    // These exercise real-file structure: PDF compressed streams + CID fonts,
    // XLSX shared-strings + styles + multi-sheet, CSV quoted fields with
    // embedded commas, ZIP nested entries. Distinct from the synthetic
    // tracer-bullet tests above which only prove the happy-path shape.

    #[test]
    fn parse_csv_real_world_quoted_fields() {
        // Harvard cs109 countries.csv — contains "Congo, Democratic Republic of"
        // (quoted field with an embedded comma). A naive comma-split would fail.
        let bytes = include_bytes!("../tests/fixtures/real.csv");
        let json = parse_csv_bytes(bytes).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let rows = v.as_array().expect("csv -> array of rows");
        assert!(rows.len() > 100, "real countries csv has many rows");
        // Header row
        assert_eq!(rows[0], serde_json::json!(["Country", "Region"]));
        // Find the row with the quoted comma field — it must be ONE cell, not split.
        let congo = rows
            .iter()
            .find(|r| {
                r.as_array().map_or(false, |c| {
                    c.first().map_or(false, |n| {
                        n.as_str()
                            .map_or(false, |s| s.contains("Democratic Republic"))
                    })
                })
            })
            .expect("Congo row present");
        let congo_cells = congo.as_array().unwrap();
        assert_eq!(congo_cells.len(), 2, "quoted-comma field stays one cell");
        assert_eq!(congo_cells[1], serde_json::json!("AFRICA"));
    }

    #[test]
    fn parse_zip_real_world_lists_entries() {
        // learningcontainer sample-zip-file.zip — real archive with multiple entries.
        let bytes = include_bytes!("../tests/fixtures/real.zip");
        let json = parse_zip_bytes(bytes).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let entries = v["entries"].as_array().expect("zip -> entries array");
        assert!(!entries.is_empty(), "real zip has entries");
        // every entry has the documented fields
        for e in entries {
            assert!(e["name"].is_string(), "entry name");
            assert!(e["size"].is_number(), "entry size");
            assert!(e["compressed_size"].is_number(), "entry compressed_size");
        }
    }

    #[test]
    fn parse_xlsx_real_world_multi_sheet_mixed_types() {
        // openpyxl-generated real.xlsx — 2 sheets (Sales, Totals), mixed types
        // (strings, ints, floats, dates), an empty row, shared-strings table.
        let bytes = include_bytes!("../tests/fixtures/real.xlsx");
        let json = parse_xlsx_bytes(bytes).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let sheets = v["sheets"].as_object().expect("xlsx -> sheets object");
        assert_eq!(sheets.len(), 2, "real.xlsx has 2 sheets");
        assert!(sheets.contains_key("Sales"), "Sales sheet");
        assert!(sheets.contains_key("Totals"), "Totals sheet");
        // Sales header row
        let sales = sheets["Sales"].as_array().unwrap();
        assert_eq!(
            sales[0],
            serde_json::json!(["Product", "Quantity", "Price", "Date"])
        );
        // Widget row: string, int, float, date-string (calamine renders dates)
        let widget = sales[1].as_array().unwrap();
        // Excel stores ALL numbers as doubles — openpyxl's 42 is read back as 42.0.
        // This real-fixture detail (missed by the synthetic xlsxwriter test,
        // which wrote a Rust i64) is why this test exists.
        assert_eq!(
            widget[1],
            serde_json::json!(42.0),
            "int cell stored as f64 by Excel"
        );
    }

    #[test]
    fn parse_pdf_real_world_extracts_text() {
        // W3C WAI dummy.pdf — a real PDF with compressed content streams,
        // not a hand-rolled minimal one. Exercises lopdf's real parser path.
        let bytes = include_bytes!("../tests/fixtures/real.pdf");
        let json = parse_pdf_bytes(bytes).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["pages"].as_array().map(|a| a.len()), Some(1), "one page");
        let text = v["text"].as_str().expect("text field");
        assert!(!text.is_empty(), "real pdf yields non-empty text");
    }
}
