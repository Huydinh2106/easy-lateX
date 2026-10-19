# Kiểm chứng GitHub thật — cập nhật 19/10/2026

Đã tạo GitHub App `easy-latex-b1640cf2` thuộc `Huydinh2106` bằng manifest, sau khi chủ tài khoản đăng nhập và đồng ý. App ID: `5353934`. Secret, khóa mã hóa và PEM được giữ trong cấu hình backend bị Git ignore; không ghi vào tài liệu này.

## Kết quả đã xác minh

- Migration bổ sung đã chạy trên Supabase PostgreSQL local. Dữ liệu cũ còn nguyên: 4 project, 27 file, 30 revision ở thời điểm kiểm tra.
- Đăng nhập GitHub thật qua backend, state, PKCE và callback desktop thành công.
- Activation tạo repository private và push source/ảnh/thư mục rỗng thành công.
- Edit lấy lease; Done tạo commit, push và được backend xác nhận. Nội dung ảnh được giữ nguyên.
- Lịch sử file đọc từ Git có hai phiên bản ứng dụng.
- Compile project lấy từ GitHub bằng Docker local thành công.
- Sau khi phiên chủ project bị logout, một commit thực hiện ngoài luồng Done vẫn được signed webhook đồng bộ về database bằng installation token chỉ đọc.
- Git 2.53.0 trong `Resources/git` của bộ cài macOS arm64 chạy được với `PATH=/nonexistent`.
- Bản đóng gói đã mở giao diện Projects trực tiếp. File public config chứa API local; kiểm tra ASAR không có `.env` hoặc `.pem`.
- Ngày 19/10: bản desktop macOS đã đăng nhập GitHub, lưu file phiên mã hóa (mode 0600), thoát hoàn toàn và tự khôi phục tài khoản Huydinh2106 trên tiến trình mới. Dashboard tải lại được project mẫu qua API và mở được source/ảnh từ GitHub. Người dùng chọn cấp quyền Keychain từng lần; không đổi sang quyền vĩnh viễn. Lần mở mới cần người dùng cho phép hộp thoại macOS, không cần đăng nhập GitHub lại.

Repository thử, chỉ chứa dữ liệu mẫu:

- [Repository để cài App](https://github.com/Huydinh2106/easy-latex-app-setup-test-20261017).
- [Project kiểm thử publication](https://github.com/Huydinh2106/easy-latex-smoke-test-6dd6d11f-60ee-4f01-970f-8f78ed041f5d).

Commit đã đối chiếu:

| Bước | Commit |
| --- | --- |
| Import ban đầu | `d93489e5959327826d0a5eb7fdae486f325b3913` |
| Done | `f0e5604e8540819c8a7dca67b9e471b5032516f2` |
| Webhook sau logout | `aecd7ef7926d4d2469875579ff0a7afc0520dd63` |

Báo cáo máy: `.local/github-smoke/report.json`. Một lần đăng nhập bị hủy trước đó đã ghi đè báo cáo dùng chung sau khi lần kiểm tra thành công hoàn tất; báo cáo được khôi phục từ output đã ghi nhận. Công cụ đã sửa để mỗi lần có file riêng, có khóa chống chạy đồng thời và chỉ cập nhật báo cáo chung khi thành công.

## Kiểm thử tự động

Ngày 19/10 đã chạy lại typecheck/lint và 111 unit/UI tests (API 6, desktop 94, LaTeX 11), cùng build desktop macOS. Trước đó đã chạy 2 test công cụ setup, 17 integration PostgreSQL trong database tạm và build API/macOS. Lần cập nhật này không thay đổi API/schema. Integration dùng GitHub giả lập, gồm webhook khi owner không còn session. Các bài integration cần điều kiện riêng được skip trong `npm test`; Docker compile được kiểm chứng trong live smoke. Bằng chứng live ở trên bổ sung cho test giả lập; chưa thay thế kiểm thử hai người dùng.

## Chưa xác minh/triển khai

- Chưa kiểm thử live mời/chấp nhận và tranh Edit với tài khoản B.
- Chưa chuyển 4 project cũ: cần chứng minh tài khoản cũ bằng OTP, rồi chọn project để chuyển. Không tự nhận quyền sở hữu hoặc xuất bản dữ liệu thật.
- Lịch sử cũ giữ thành archive per-file; chưa có công cụ giữ nguyên commit Git cũ hoặc migration nhiều đợt cho project vượt giới hạn.
- Chưa deploy API production, ký/notarize bản phát hành, hoặc kiểm tra máy Mac sạch/Windows/Linux.
- Bản local đã ký ad-hoc hợp lệ ở cuối quá trình đóng gói. Chưa có chứng chỉ Developer ID/notarization; cập nhật build có thể khiến macOS hỏi lại quyền Keychain.
- Webhook hiện dùng Smee cho môi trường thử nghiệm; cần HTTPS endpoint phù hợp khi vận hành lâu dài.

## Chạy lại môi trường local

```sh
cd /Users/dinhviethuy/easy-lateX
npm run supabase:start
npm run api:dev
```

Terminal riêng chạy webhook với URL đã lưu trong `GITHUB_SETUP_WEBHOOK_URL` (đọc URL từ `.env.local`, không sao chép secret vào lệnh), dùng `npx smee-client --url URL --path /github/webhook --port 4318`.

Mở bộ cài tại `apps/desktop/out/Easy LaTeX-darwin-arm64/Easy LaTeX.app`, chọn Continue with GitHub. Địa chỉ API local đã được nhúng vào bản build này. Sau khi chọn server khác trong Connection settings, giá trị người dùng lưu sẽ được ưu tiên.


## Bản sửa và UI ngày 19/10

- Sửa lỗi chữ ký của bản đóng gói: ký sau khi Info.plist và ASAR integrity đã hoàn tất; `codesign --verify --deep --strict` qua. Ad-hoc local không bật hardened runtime (không có Developer ID team); cấu hình identity phát hành giữ mặc định của bộ ký. Git đi kèm vẫn chạy với PATH rỗng.
- Kho phiên đọc lại khi mã hóa khả dụng trở lại, giữ các thay đổi trong bộ nhớ, tuần tự hóa I/O và xóa file credential khi đăng xuất kể cả Keychain đang khóa. Không lưu token plaintext.
- Chỉnh UI đăng nhập, trạng thái đợi trình duyệt/hủy/thử lại, Connection settings, menu tài khoản, lời mời và migration. Lời mời giải thích quyền ghi ngoài app; migration có bước xem lại project. Tab/Escape/focus và lỗi API được kiểm thử.
- Đã kiểm tra trực quan màn hình đăng nhập và lời mời trong app thật; sau khôi phục phiên, compile project mẫu thành công và hiển thị PDF trong editor. Không gửi lời mời hoặc chuyển dữ liệu thật trong lần kiểm tra UI này.
- Ảnh kiểm chứng local: `.local/ui-proof/sign-in-20261019.png`, `.local/ui-proof/session-restored-20261019.png`, `.local/ui-proof/invitation-20261019.png`, `.local/ui-proof/workspace-pdf-20261019.png`. Báo cáo lần này: `.local/github-smoke/desktop-verification-20261019.json`.
