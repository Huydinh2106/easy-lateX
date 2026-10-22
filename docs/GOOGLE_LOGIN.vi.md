> Tài liệu lưu trữ của luồng cũ. Luồng đăng nhập mới chỉ dùng GitHub App; xem [COLLABORATION.md](COLLABORATION.md). Không dùng cấu hình Google này cho luồng mới.

# Bật đăng nhập Google cho Easy LaTeX

Phần mã đăng nhập đã có sẵn. Bạn chỉ cần tạo OAuth client riêng để bật nút
**Continue with Google**. Hướng dẫn này dùng cho Supabase đang chạy cục bộ.

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và tạo hoặc chọn
   một project, ví dụ `Easy LaTeX`.
2. Mở **Google Auth Platform → Branding**, nhập tên ứng dụng và email liên hệ.
   Trong **Audience**, chọn **External** nếu muốn phục vụ người dùng phổ thông.
   Khi ứng dụng còn ở chế độ Testing, thêm tài khoản Google của bạn vào **Test users**.
3. Trong **Data Access**, cấu hình các scope `openid`,
   `https://www.googleapis.com/auth/userinfo.email` và
   `https://www.googleapis.com/auth/userinfo.profile`.
4. Trong **Clients → Create client**, chọn **Web application**. Dù Easy LaTeX là
   ứng dụng desktop, Google sẽ chuyển về Supabase trước, nên luồng này dùng client Web.
5. Thêm **Authorized redirect URI** đúng như sau:

   ```text
   http://127.0.0.1:54321/auth/v1/callback
   ```

6. Sao chép **Client ID** và **Client Secret** vào tệp `.env` ở thư mục gốc dự án:

   ```dotenv
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=YOUR_CLIENT_SECRET
   ```

   Thay các giá trị mẫu bằng thông tin thật. `.env` đã được Git bỏ qua; không cần
   gửi secret vào chat.
7. Dừng API và bản phát triển ứng dụng đang chạy, rồi chạy từ thư mục dự án:

   ```sh
   npm run supabase:stop
   npm run supabase:start
   npm run collaboration:setup
   npm run api:dev
   ```

   Mở terminal thứ hai và chạy:

   ```sh
   npm run dev
   ```

Vào **Sign in to collaborate → Continue with Google**. Trình duyệt hệ thống
sẽ mở trang đăng nhập. Sau khi cho phép đăng nhập, quay lại Easy LaTeX.

Nếu Google báo `redirect_uri_mismatch`, kiểm tra URI ở bước 5: địa chỉ phải là
`127.0.0.1`, đúng cổng `54321` và đúng đường dẫn `/auth/v1/callback`. Nếu báo chưa
được phép truy cập ứng dụng thử nghiệm, kiểm tra tài khoản trong **Test users**.
Không thêm callback có cổng ngẫu nhiên của desktop vào cấu hình Google; Supabase
đã có cấu hình để chuyển tiếp về ứng dụng.

Khi đưa lên cloud, thay callback Google bằng callback của Supabase project thật,
cấu hình provider trong Supabase Dashboard và dùng cấu hình backend tương ứng.
Các bước chạy cục bộ, giới hạn hiện tại và kiểm thử nằm trong
[COLLABORATION.md](./COLLABORATION.md).

Tham khảo: [hướng dẫn Google của Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google).
