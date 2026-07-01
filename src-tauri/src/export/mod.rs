// export - Document export commands.
//
// Single home for all export formats. HTML/PDF render from a self-contained HTML
// document produced by the frontend (WebView WYSIWYG); future Pandoc-backed
// formats (LaTeX/Typst/docx/odt) will route through canonical Markdown instead.
// See DEV.md §19 for the overall design.

pub mod html;
pub mod pdf;
