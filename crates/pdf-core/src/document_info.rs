//! The document properties of the PDF. krilla writes Title, Author, Subject, Keywords, Creator,
//! Producer and one date (as both CreationDate and ModDate) to the Info dictionary and the XMP
//! packet; its metadata has no field for Company, Revision or a second date, so when the deck sets
//! any of them, `with_custom_entries` appends an incremental update (ISO 32000-1 7.5.6) whose Info
//! dictionary holds them all, as the Puppeteer renderer does (`packages/puppeteer/src/pdfInfo.ts`).

use std::fmt::Write;

use crate::model::{Metadata, UtcDate};

/// The default /Creator and /Producer of every PDF, as PowerPoint's Save as PDF names itself in
/// both. `PDF_PRODUCER` in `packages/model/src/renderer.ts` is the same string;
/// tests/pdfMetadata.test.ts checks that the PDFs of both renderers carry it.
pub(crate) const PRODUCER: &str = "PdfLapas";

/// The XMP element krilla (through xmp-writer) writes the modification date in.
const XMP_MODIFY_DATE: &[u8] = b"<xmp:ModifyDate>";

/// krilla's metadata for `metadata`: Title, Author, Subject (krilla's `description`, written as
/// /Subject and dc:description) and Keywords when set, Creator and Producer (`PRODUCER` unless
/// set), and the creation date, or the modification date without one. No date unless the deck
/// sets one, so the same deck gives the same bytes.
pub(crate) fn krilla_metadata(metadata: &Metadata) -> krilla::metadata::Metadata {
    let Metadata {
        title,
        author,
        subject,
        keywords,
        creator,
        producer,
        ..
    } = metadata;
    let mut pdf = krilla::metadata::Metadata::new()
        .creator(creator.as_deref().unwrap_or(PRODUCER).to_string())
        .producer(producer.as_deref().unwrap_or(PRODUCER).to_string());
    if let Some(title) = title {
        pdf = pdf.title(title.clone());
    }
    if let Some(author) = author {
        pdf = pdf.authors(vec![author.clone()]);
    }
    if let Some(subject) = subject {
        pdf = pdf.description(subject.clone());
    }
    if let Some(keywords) = keywords {
        // One item: krilla joins the list with ", ", so the deck's string is written as given.
        pdf = pdf.keywords(vec![keywords.clone()]);
    }
    if let Some((created, _)) = dates(metadata) {
        // No UTC offset: krilla then writes `Z`, in the PDF date and in XMP.
        pdf = pdf.creation_date(
            krilla::metadata::DateTime::new(created.year)
                .month(created.month)
                .day(created.day)
                .hour(created.hour)
                .minute(created.minute)
                .second(created.second),
        );
    }
    pdf
}

/// The creation and modification dates: either one alone is both, as krilla has a single date.
fn dates(metadata: &Metadata) -> Option<(UtcDate, UtcDate)> {
    let created = metadata.creation_date.or(metadata.modification_date)?;
    Some((created, metadata.modification_date.unwrap_or(created)))
}

/// `pdf` (krilla's output) with an incremental update whose Info dictionary holds every property of
/// `metadata`, including the non-standard /Company and /Revision (14.3.3 allows other keys) and a
/// modification date that differs from the creation date, which krilla cannot write. XMP has no
/// standard property for Company or Revision and krilla writes no custom ones, so they are in the
/// Info dictionary only; a differing modification date replaces krilla's `xmp:ModifyDate` in place
/// (same length, so no offset moves). Without any of them, returns `pdf` unchanged.
pub(crate) fn with_custom_entries(mut pdf: Vec<u8>, metadata: &Metadata) -> Result<Vec<u8>, String> {
    let Metadata {
        title,
        author,
        subject,
        company,
        revision,
        keywords,
        creator,
        producer,
        ..
    } = metadata;
    let dates = dates(metadata);
    let modified = dates.and_then(|(created, modified)| (created != modified).then_some(modified));
    if company.is_none() && revision.is_none() && modified.is_none() {
        return Ok(pdf);
    }
    let fail = |problem: &str| format!("cannot write the document properties to the PDF: krilla's output {problem}");
    if let Some(modified) = modified {
        let start = rfind(&pdf, XMP_MODIFY_DATE).ok_or_else(|| fail("has no xmp:ModifyDate"))? + XMP_MODIFY_DATE.len();
        let value = xmp_date(modified);
        let end = start + value.len();
        if pdf.get(end..).is_none_or(|rest| !rest.starts_with(b"</xmp:ModifyDate>")) {
            return Err(fail("has an xmp:ModifyDate in another format"));
        }
        pdf.get_mut(start..end)
            .ok_or_else(|| fail("has no xmp:ModifyDate"))?
            .copy_from_slice(value.as_bytes());
    }
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
        ("Title", title.as_deref()),
        ("Author", author.as_deref()),
        ("Subject", subject.as_deref()),
        ("Company", company.as_deref()),
        ("Revision", revision.as_deref()),
        ("Keywords", keywords.as_deref()),
        ("Creator", Some(creator.as_deref().unwrap_or(PRODUCER))),
        ("Producer", Some(producer.as_deref().unwrap_or(PRODUCER))),
    ] {
        if let Some(value) = value {
            let _ = write!(info, "/{key}{}", text_string(value)); // writing to a String cannot fail
        }
    }
    if let Some((created, modified)) = dates {
        let _ = write!(info, "/CreationDate{}/ModDate{}", pdf_date(created), pdf_date(modified)); // as above
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

/// A PDF date string (7.9.4) in UTC, as krilla's pdf-writer writes it: `(D:YYYYMMDDHHmmSSZ)`.
fn pdf_date(date: UtcDate) -> String {
    let UtcDate {
        year,
        month,
        day,
        hour,
        minute,
        second,
    } = date;
    format!("(D:{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}Z)")
}

/// An XMP date in UTC, as krilla's xmp-writer writes it: `YYYY-MM-DDTHH:mm:ssZ`.
fn xmp_date(date: UtcDate) -> String {
    let UtcDate {
        year,
        month,
        day,
        hour,
        minute,
        second,
    } = date;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
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
        let object = "\n2 0 obj\n<</Title<FEFF00510033002000FC>/Company<FEFF00410063006D0065>/Revision<FEFF0037>/Creator<FEFF005000640066004C0061007000610073>/Producer<FEFF005000640066004C0061007000610073>>>\nendobj\n";
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
            "cannot write the document properties to the PDF: krilla's output has no startxref"
        );
    }
}
