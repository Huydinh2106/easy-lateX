# Đặc tả compiler runtime và phân phối Easy LaTeX

- **Trạng thái:** Giai đoạn A đã triển khai và kiểm thử
- **Phiên bản:** 0.2
- **Ngày:** 2026-10-02
- **Phạm vi:** Biên dịch LaTeX trong development và bản desktop phát hành
- **Chưa thuộc phạm vi hiện tại:** Xây dựng bộ cài `.pkg`

## 1. Mục tiêu

Easy LaTeX phải mang lại một hành vi duy nhất cho người dùng:

> Mở project, bấm Compile và nhận PDF.

Người dùng cuối không phải cài hoặc cấu hình Docker, TeX Live, `latexmk`, biến
môi trường hay package LaTeX. Việc compiler sử dụng công nghệ gì là chi tiết
triển khai và không xuất hiện trong luồng sử dụng chính.

Trong quá trình phát triển, compiler được phép chạy bằng Docker để tránh cài TeX
lên máy phát triển. Trong bản phát hành, compiler phải là runtime native, portable
và đi kèm Easy LaTeX.

## 2. Quyết định kiến trúc

| Môi trường | Backend | Người dùng cần chuẩn bị |
| --- | --- | --- |
| Development | `DockerLatexCompiler` với TeX Live full | Developer có Docker Desktop |
| Production | `NativeLatexCompiler` với TeX Live portable | Không cần phần mềm khác |

Hai backend phải thực hiện cùng một `CompilerBackend` contract. Renderer,
toolbar, Problems panel và PDF viewer không được biết backend nào đang chạy.

```text
Renderer
   │
   ▼
CompileManager
   │
   ▼
CompilerBackend
   ├── DockerLatexCompiler   (development)
   └── NativeLatexCompiler   (production)
```

Docker là công cụ development và CI, không phải dependency của sản phẩm phát
hành. TeX Live không được cài vào hệ thống, không sửa `PATH` và không dùng binary
TeX có sẵn trên máy người dùng.

## 3. Mục tiêu chức năng

1. Hỗ trợ `pdfLaTeX`, `XeLaTeX` và `LuaLaTeX`.
2. Sử dụng `latexmk` để điều phối số lần chạy compiler, bibliography và index.
3. Bao gồm Biber, BibTeX, MakeIndex, SyncTeX, font và language packages.
4. Dùng bộ package TeX Live full thay vì bổ sung package khi phát sinh lỗi.
5. Tạo PDF, SyncTeX, log và auxiliary files trong thư mục build riêng.
6. Giữ PDF thành công gần nhất nếu lần compile mới thất bại.
7. Cho phép hủy compile đang chạy.
8. Chuyển lỗi LaTeX thành diagnostic có file, dòng và thông báo dễ hiểu.

## 4. Ngoài phạm vi hiện tại

- Không xây `.pkg`, DMG, MSI hoặc bootstrap installer trong giai đoạn hiện tại.
- Không tự cập nhật TeX Live package bằng `tlmgr` khi compile.
- Không hỗ trợ nhiều phiên bản TeX Live trong UI ở MVP.
- Không dùng compiler từ `/usr/local`, MacTeX hoặc PATH của hệ thống.
- Không xây cloud compile service.
- Không cho tài liệu thực thi shell command tùy ý.

## 5. Trải nghiệm người dùng bản phát hành

Luồng cài đặt mục tiêu:

```text
Tải Easy LaTeX
      ↓
Chấp nhận điều khoản và cài ứng dụng
      ↓
Ứng dụng cùng compiler runtime được cài
      ↓
Mở project
      ↓
Bấm Compile
      ↓
Nhận PDF
```

Các thuật ngữ `Docker`, `image`, `container`, `tlmgr`, `TEXMF` và đường dẫn
compiler không xuất hiện trong giao diện người dùng cuối.

Nếu runtime bị thiếu hoặc hỏng, thông báo sản phẩm là:

> PDF compiler is unavailable. Repair or reinstall Easy LaTeX.

Không yêu cầu người dùng chạy command trong Terminal.

## 6. Compiler contract

Contract mức kiến trúc dự kiến:

```ts
interface CompilerBackend {
  status(): Promise<CompilerStatus>;
  compile(request: CompilerRequest): Promise<CompilerOutput>;
  cancel(): Promise<boolean>;
}

type CompilerStatus =
  | { state: "ready"; version: string }
  | { state: "unavailable"; reason: string }
  | { state: "corrupted"; reason: string };
```

`CompilerRequest` chỉ chứa dữ liệu thuộc nghiệp vụ:

- workspace path;
- output directory;
- root document;
- engine;
- callback cho status và log output.

Không đưa Docker arguments, host executable path hoặc native runtime layout vào
shared API với renderer.

## 7. Luồng compile chuẩn

```text
Validate project/root document
             ↓
Save nội dung đang sửa
             ↓
Kiểm tra compiler status
             ↓
Chuẩn bị output directory
             ↓
Chạy latexmk bằng backend đã chọn
             ↓
Thu log + parse diagnostics
             ↓
Xác minh PDF/SyncTeX artifact
             ↓
Cập nhật preview hoặc giữ PDF cũ nếu thất bại
```

Trạng thái UI:

| Phase | Nội dung hiển thị |
| --- | --- |
| `idle` | Ready to compile |
| `starting` | Starting pdfLaTeX/XeLaTeX/LuaLaTeX |
| `running` | Compiling |
| `cancelling` | Cancelling… |
| `success` | PDF updated |
| `failed` | Compilation failed |
| `cancelled` | Compilation cancelled |

Không hiển thị phần trăm giả khi compiler không cung cấp tiến trình định lượng.

## 8. Backend development bằng Docker

### 8.1 Yêu cầu

- Dùng image TeX Live full được khóa phiên bản cụ thể.
- Không dùng tag chuyển động như `latest`.
- Image phải hỗ trợ ARM64 và AMD64.
- Không cài package bổ sung theo từng project.
- Không cài TeX Live lên macOS development host.

### 8.2 Chính sách runtime

Container compile phải:

- chạy với `--network none`;
- dùng root filesystem read-only;
- drop toàn bộ Linux capabilities;
- bật `no-new-privileges`;
- giới hạn CPU, RAM và process count;
- mount workspace read-only;
- chỉ mount output directory ở chế độ writable;
- chạy `latexmk` với `-no-shell-escape`;
- có timeout và hỗ trợ cancel.

Image development hiện tại là full TeX Live snapshot `2026-09-15`, được khóa
bằng OCI manifest digest đa kiến trúc. `/tmp` là `noexec`; Biber dùng một tmpfs
thực thi riêng, rỗng sau mỗi container, vì binary PAR của Biber phải tự giải nén
interpreter. Không package TeX nào được cài thêm trong Dockerfile.

### 8.3 Development setup

Việc pull image là bước dành cho developer và có thể thực hiện bằng script npm.
Nó không phải một phần của trải nghiệm sản phẩm phát hành.

## 9. Backend production bằng TeX Live portable

### 9.1 Thành phần runtime

Runtime production phải có:

- TeX Live full scheme;
- `latexmk`;
- pdfTeX, XeTeX và LuaTeX;
- BibTeX và Biber;
- MakeIndex và SyncTeX;
- language collections;
- fonts và runnable packages.

Documentation và source packages của TeX Live có thể bị loại để giảm dung lượng.
Việc loại bỏ không được làm thiếu package cần để compile tài liệu.

### 9.2 Layout macOS dự kiến

```text
Easy LaTeX.app/
└── Contents/
    └── Resources/
        └── compiler/
            ├── manifest.json
            └── texlive/
                └── 2026/
```

Runtime binary không nằm trong `app.asar`. Electron phải đóng gói runtime bằng
`extraResource` hoặc cơ chế tương đương.

Các file cache/config writable nằm tại:

```text
~/Library/Application Support/Easy LaTeX/compiler/
├── texmf-var/
├── texmf-config/
└── cache/
```

Ứng dụng thiết lập `PATH`, `TEXMFVAR`, `TEXMFCONFIG` và `HOME` riêng cho compiler
child process. Không thay đổi environment của hệ thống.

### 9.3 Runtime manifest

`manifest.json` tối thiểu gồm:

```json
{
  "schemaVersion": 1,
  "texLiveVersion": "2026",
  "runtimeVersion": "2026.09.15",
  "platform": "darwin",
  "architecture": "arm64",
  "sha256": "<artifact checksum>"
}
```

Manifest là nguồn xác định version và integrity. Tên thư mục không được dùng như
nguồn xác thực duy nhất.

## 10. Bảo mật production

Native runtime không có mức cô lập như container, vì vậy bắt buộc:

1. Không tìm binary qua system PATH.
2. Chỉ thực thi binary nằm trong runtime đã xác minh.
3. Luôn tắt shell escape ở MVP.
4. Không chuyển chuỗi command qua shell; dùng `spawn` với argument array.
5. Giới hạn thời gian, kích thước log và số process.
6. Chuẩn hóa và kiểm tra mọi workspace/output path.
7. Không cho output thoát khỏi thư mục build.
8. Runtime là read-only trong app bundle.
9. App và nested executables phải được code signed/notarized trước khi phát hành.
10. Giữ nguyên source và PDF thành công trước đó khi compile bị hủy hoặc lỗi.

## 11. Phiên bản và khả năng tái lập

- Một bản Easy LaTeX phát hành trỏ tới đúng một runtime version mặc định.
- Runtime version tăng khi TeX Live snapshot hoặc compiler tooling thay đổi.
- Không cập nhật package riêng lẻ tại runtime.
- Update phải thay toàn bộ runtime artifact đã được kiểm thử.
- Metadata project có thể lưu runtime version trong tương lai để hỗ trợ tài liệu cũ.
- Hỗ trợ chọn nhiều phiên bản TeX Live là tính năng sau MVP.

## 12. Kiểm thử bắt buộc

### 12.1 Unit tests

- mapping engine sang `latexmk` arguments;
- path validation;
- cancellation;
- compiler status;
- log parsing;
- giữ PDF cũ khi compile lỗi.

### 12.2 Integration fixtures

Bộ fixture phải có ít nhất:

1. tài liệu pdfLaTeX cơ bản;
2. tài liệu tiếng Việt dùng `vietnam.sty`;
3. Unicode/OpenType với XeLaTeX;
4. LuaLaTeX;
5. BibTeX;
6. Biber;
7. TikZ;
8. `booktabs`, `longtable`, `listings`, `hyperref`;
9. multi-file với `\input`/`\include`;
10. tài liệu lỗi để kiểm tra diagnostics.

Mỗi fixture phải chạy trên Docker backend trong development và native backend
trước release. Kết quả không nhất thiết byte-identical nhưng phải thành công và
tạo đúng artifact mong đợi.

### 12.3 Release tests

Trước khi phát hành production:

- thử trên máy macOS sạch không có Docker, MacTeX, Node.js hoặc npm;
- cài ứng dụng bằng artifact phát hành;
- compile toàn bộ integration fixtures;
- xác minh không dùng system TeX;
- xác minh Gatekeeper, code signing và notarization;
- gỡ ứng dụng và xác minh không để lại system-level PATH/configuration.

## 13. Kế hoạch theo giai đoạn

### Giai đoạn A — Development hiện tại

- Giữ `DockerLatexCompiler`.
- Chuyển sang TeX Live full image được pin.
- Thêm integration fixtures.
- Hoàn thiện compile, diagnostics, PDF và SyncTeX.
- Không làm `.pkg`.

### Giai đoạn B — Alpha production runtime

- Tạo TeX Live portable artifact cho macOS ARM64.
- Cài artifact vào một app bundle development.
- Triển khai `NativeLatexCompiler`.
- Chạy cùng test suite cho cả hai backend.

### Giai đoạn C — Release candidate

- Đóng gói runtime bằng Electron resources.
- Code sign toàn bộ nested binaries.
- Notarize app.
- Xây `.pkg` hoặc artifact installer đã chọn.
- Kiểm thử trên máy sạch.

### Giai đoạn D — Sau MVP

- Runtime updater có checksum/signature và rollback.
- Intel macOS và Windows runtime.
- Nhiều phiên bản TeX Live theo project.
- Bootstrap installer/CDN nếu cần giảm kích thước file tải ban đầu.

## 14. Tiêu chí nghiệm thu giai đoạn hiện tại

Giai đoạn development compiler được coi là đạt khi:

1. Không cài TeX Live lên development host.
2. Một full image duy nhất compile được toàn bộ fixture.
3. Tài liệu tiếng Việt không còn lỗi thiếu `vietnam.sty`.
4. Không cần thêm package vào image sau từng lỗi tài liệu.
5. Compile container không có network và không có shell escape.
6. Cancel dừng được compile mà không làm mất PDF thành công trước đó.
7. Test, typecheck và lint đều đạt.

## 15. Các quyết định cần duyệt trước khi triển khai production runtime

1. Nền tảng đầu tiên có phải chỉ là macOS ARM64 hay không.
2. Bản cài đầu tiên là all-in-one hay bootstrap installer.
3. Mức dung lượng tối đa chấp nhận được cho runtime.
4. Có cần hỗ trợ compile offline ngay sau cài đặt hay không.
5. Thời điểm bắt đầu hỗ trợ macOS Intel và Windows.
6. Có lưu TeX Live version theo project ngay trong MVP hay để sau.

Không bắt đầu `NativeLatexCompiler` hoặc bộ cài production trước khi các quyết
định trên được duyệt.
