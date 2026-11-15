//! The document properties of the PDF. krilla writes Title, Author and Subject to the Info
//! dictionary and the XMP packet; its metadata has no field for Company or Revision, so when the
//! deck sets either, `with_custom_entries` appends an incremental update (ISO 32000-1 7.5.6) whose
//! Info dictionary holds all five, as the Puppeteer renderer does (`packages/puppeteer/src/pdfInfo.ts`).

use std::fmt::Write;

use crate::model::Metadata;

/// krilla's metadata for `metadata`: Title, Author and Subject (krilla's `description`, written as
/// /Subject and dc:description). None without any, so a document without them has no Info
/// dictionary or XMP packet.
pub(crate) fn krilla_metadata(metadata: &Metadata) -> Option<krilla::metadata::Metadata> {
    let Metadata { title, author, subject, .. } = metadata;
    if title.is_none() && author.is_none() && subject.is_none() {
        return None;
    }
    let mut pdf = krilla::metadata::Metadata::new();
    if let Some(title) = title {
        pdf = pdf.title(title.clone());
    }
    if let Some(author) = author {
        pdf = pdf.authors(vec![author.clone()]);
    }
    if let Some(subject) = subject {
        pdf = pdf.description(subject.clone());
    }
    Some(pdf)
}

/// `pdf` (krilla's output) with an incremental update whose Info dictionary holds every property of
/// `metadata`, including the non-standard /Company and /Revision (14.3.3 allows other keys). XMP has
/// no standard property for either and krilla writes no custom ones, so they are in the Info
/// dictionary only. Without a company or revision, returns `pdf` unchanged.
pub(crate) fn with_custom_entries(mut pdf: Vec<u8>, metadata: &Metadata) -> Result<Vec<u8>, String> {
    let Metadata {
        title,
        author,
        subject,
        company,
        revision,
    } = metadata;
    if company.is_none() && revision.is_none() {
        return Ok(pdf);
    }
    let fail = |problem: &str| format!("cannot add Company and Revision to the PDF: krilla's output {problem}");
    let startxref = rfind(&pdf, b"startxref").ok_or_else(|| fail("has no startxref"))?;
    let trailer = rfind(pdf.get(..startxref).unwrap_or_default(), b"trailer").ok_or_else(|| fail("has no trailer"))?;
    let tail = pdf
        .get(trailer..)
        .and_then(|t| std::str::from_utf8(t).ok())
        .ok_or_else(|| fail("has a trailer that is not ASCII"))?;
    let prev = after(tail, "startxref")
        .and_then(number)
        .ok_or_else(|| fail("has no cross-reference offset after startxref"))?;
    let size = after(tail, "/Size").and_then(number).ok_or_else(|| fail("has no /Size in its trailer"))?;
    let root = after(tail, "/Root")
        .and_then(|rest| rest.split_once('R'))
        .map(|(reference, _)| reference.trim())
        .ok_or_else(|| fail("has no /Root in its trailer"))?;
    let id = after(tail, "/ID")
        .and_then(|rest| rest.split_once(']'))
        .map(|(ids, _)| format!("/ID{ids}]"))
        .unwrap_or_default();

    let mut info = String::new();
    for (key, value) in [
        ("Title", title),
        ("Author", author),
        ("Subject", subject),
        ("Company", company),
        ("Revision", revision),
    ] {
        if let Some(value) = value {
            let _ = write!(info, "/{key}{}", text_string(value)); // writing to a String cannot fail
        }
    }
    let object = format!("\n{size} 0 obj\n<<{info}>>\nendobj\n");
    let object_offset = pdf.len() + 1;
    let xref_offset = pdf.len() + object.len();
    let update = format!(
        "{object}xref\n{size} 1\n{object_offset:010} 00000 n\r\ntrailer\n<</Size {}/Root {root} R/Info {size} 0 R/Prev {prev}{id}>>\nstartxref\n{xref_offset}\n%%EOF",
        size + 1
    );
    pdf.extend_from_slice(update.as_bytes());
    Ok(pdf)
}

/// The offset of the last `needle` in `haystack`.
fn rfind(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).rposition(|window| window == needle)
}

/// The unsigned integer at the start of `text`, after white space.
fn number(text: &str) -> Option<usize> {
    let text = text.trim_start();
    text.get(..text.bytes().take_while(u8::is_ascii_digit).count())?.parse().ok()
}

/// The text after the first `key` in `dictionary`.
fn after<'a>(dictionary: &'a str, key: &str) -> Option<&'a str> {
    dictionary.split_once(key).map(|(_, rest)| rest)
}

/// A PDF text string as UTF-16BE with its byte order mark, in hex: any character, nothing to escape
/// (7.9.2.2).
fn text_string(value: &str) -> String {
    value.encode_utf16().fold(String::from("<FEFF"), |mut hex, unit| {
        let _ = write!(hex, "{unit:04X}");
        hex
    }) + ">"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(company: Option<&str>) -> Metadata {
        Metadata {
            title: Some("Q3 ü".into()),
            company: company.map(Into::into),
            ..Default::default()
        }
    }

    #[test]
    fn appends_an_info_dictionary_with_company_and_revision() {
        let pdf = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\nxref\n0 2\ntrailer\n<</Size 2/Root 1 0 R/Info 1 0 R/ID[(a)(b)]>>\nstartxref\n29\n%%EOF".to_vec();
        let out = with_custom_entries(
            pdf.clone(),
            &Metadata {
                revision: Some("7".into()),
                ..metadata(Some("Acme"))
            },
        )
        .unwrap();
        let update = String::from_utf8(out.get(pdf.len()..).unwrap().to_vec()).unwrap();
        let object = "\n2 0 obj\n<</Title<FEFF00510033002000FC>/Company<FEFF00410063006D0065>/Revision<FEFF0037>>>\nendobj\n";
        let (object_offset, xref_offset) = (pdf.len() + 1, pdf.len() + object.len());
        assert_eq!(
            update,
            format!(
                "{object}xref\n2 1\n{object_offset:010} 00000 n\r\ntrailer\n<</Size 3/Root 1 0 R/Info 2 0 R/Prev 29/ID[(a)(b)]>>\nstartxref\n{xref_offset}\n%%EOF"
            )
        );
        assert!(out.get(object_offset..).unwrap().starts_with(b"2 0 obj"));
        assert!(out.get(xref_offset..).unwrap().starts_with(b"xref\n2 1"));
    }

    #[test]
    fn leaves_the_pdf_alone_without_company_or_revision_and_fails_on_a_broken_one() {
        assert_eq!(with_custom_entries(b"x".to_vec(), &metadata(None)).unwrap(), b"x");
        assert_eq!(
            with_custom_entries(b"x".to_vec(), &metadata(Some("Acme"))).unwrap_err(),
            "cannot add Company and Revision to the PDF: krilla's output has no startxref"
        );
    }
}
