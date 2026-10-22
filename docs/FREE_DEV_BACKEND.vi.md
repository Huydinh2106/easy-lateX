# Backend dev miễn phí cho macOS và Windows

Backend gồm API Node.js và PostgreSQL trên Render, cùng region Singapore.
Hai desktop dùng cùng URL HTTPS; không cần giữ máy Mac bật.
LaTeX/Docker và Git của desktop vẫn chạy trên từng máy.

## Giới hạn miễn phí

Tại ngày 22/10/2026, [Render Free](https://render.com/docs/free) hỗ trợ API và
PostgreSQL miễn phí. API ngủ sau 15 phút không có traffic vào; lần truy cập tiếp
theo có thể mất khoảng một phút để khởi động. PostgreSQL miễn phí hết hạn sau
30 ngày. Không thêm phương thức thanh toán hoặc nâng gói trong quy trình này.
Xuất database test trước khi hết hạn nếu cần giữ dữ liệu. Không dùng dịch vụ
ping định kỳ để tránh chế độ ngủ.

## Triển khai

1. Đăng nhập Render, tạo Blueprint từ repository và nhánh có `render.yaml`.
   Kiểm tra cả API và database đều là **Free** trước khi tạo.
2. Điền các biến GitHub trong Blueprint bằng cấu hình GitHub App hiện có.
   Không tạo GitHub App trùng. Giữ khóa mã hóa cũ nếu chuyển database cũ.
3. Thêm Secret File `github-app.pem`, dùng nội dung private key của App.
   Backend đọc file tại `/etc/secrets/github-app.pem`; không commit file này.
4. Khi biết URL dịch vụ, đặt `GITHUB_CALLBACK_URL` thành
   `https://TEN-DICH-VU.onrender.com/auth/github/callback` rồi deploy lại.
5. Trong GitHub App, cập nhật Callback URL như trên và Webhook URL thành
   `https://TEN-DICH-VU.onrender.com/github/webhook`. Giữ webhook secret hiện có.
6. Mở `https://TEN-DICH-VU.onrender.com/health`, chờ dịch vụ thức dậy nếu cần.
   Kết quả phải là JSON có `status: ok` và `collaboration: github`.
7. Trên cả hai desktop, đăng xuất nếu cần, mở **Connection settings**, nhập
   URL gốc HTTPS rồi **Save server**, sau đó đăng nhập GitHub.

Build chỉ cài dependency API, không tải Electron hay compiler image lên cloud.
Lệnh startup chạy migration trong transaction và có khóa để tránh hai lần
startup cùng sửa schema. Database mới được tạo schema GitHub độc lập; database
cũ giữ nội dung và được áp dụng migration cộng tác hiện có. Database mới là môi
trường test riêng, không tự sao chép tài khoản/dự án đang có trên Mac.

Database không mở public trong Blueprint. Kết nối nội bộ là kết nối PostgreSQL
trực tiếp để hỗ trợ LISTEN/NOTIFY. Nếu chọn một database khác, không dùng
transaction pooler cho API này.

## Kiểm chứng

- Kiểm tra `/health` và request chưa đăng nhập nhận 401.
- Kiểm tra chữ ký webhook: request sai chữ ký phải bị từ chối.
- Đăng nhập từ cả Mac và Windows; mở lại ứng dụng để kiểm tra giữ phiên.
- Dùng project mẫu: mời tài khoản thứ hai, Edit/Done, xác nhận commit trên
  GitHub và cập nhật tự động trên máy còn lại.
- Thử hai người Edit cùng file và mỗi người Edit một file khác nhau.
- Chờ luồng SSE hoạt động ít nhất vài phút, thử ngắt/kết nối lại mạng.
- Nếu API vừa ngủ, mở `/health` và chờ nó thức trước khi đăng nhập lại.

Để test migration trên PostgreSQL local bằng database tạm riêng biệt:

```sh
GITHUB_MIGRATION_TEST_ADMIN_URL=postgresql://... node --test scripts/test/github-database.test.mjs
DATABASE_URL=postgresql://... npm run github:test -- --standalone
```

Các lệnh test từ chối host không phải localhost, chỉ xóa database tạm do chính
nó tạo. Bộ integration dùng PostgreSQL thật và GitHub giả lập; không thay thế
kiểm thử đăng nhập/cộng tác thật từ hai desktop.
