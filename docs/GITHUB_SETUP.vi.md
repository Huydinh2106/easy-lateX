# Các việc còn thiếu và cách tự chạy GitHub collaboration

Trạng thái cập nhật ngày 19/10/2026: đã cấu hình App `easy-latex-b1640cf2`, chạy migration local và kiểm chứng đăng nhập, tạo repository private, push/Done, lịch sử, tài nguyên, Docker compile và signed webhook thật. Bản macOS đã giữ phiên qua lần thoát/mở lại sau khi người dùng cấp quyền Keychain từng lần. Xem [báo cáo kiểm chứng](GITHUB_VERIFICATION.vi.md). Chưa kiểm thử hai tài khoản, chuyển dữ liệu cũ hoặc deploy production. Các bước đăng ký bên dưới dành cho môi trường mới; máy hiện tại không cần tạo lại App hay sinh lại khóa.

## 1. Phân biệt việc cần bạn thao tác và việc còn phải viết code

| Việc | Trạng thái | Ai cần làm |
| --- | --- | --- |
| Đăng ký GitHub App, client secret và private key | Đã hoàn tất trên máy hiện tại | Không tạo lại; giữ cấu hình backend |
| Điền cấu hình backend, áp dụng migration, khởi động API | Đã hoàn tất local | Mục 5 hướng dẫn chạy lại sau khi khởi động máy |
| Kiểm thử hai tài khoản thật | Chưa chạy | Cần tài khoản B và quyền mời vào repository mẫu hiện có |
| API dùng chung qua HTTPS | Chưa có dịch vụ production | Mục 6 hướng dẫn thử qua tunnel; triển khai lâu dài cần máy chủ/domain do bạn chọn |
| Chuyển project cũ | Có luồng chuyển; chưa chuyển dữ liệu thật | Cần cấu hình hệ thống cũ và xác nhận tài khoản bằng OTP |
| Git đi kèm bộ cài | Đã đóng gói, kiểm tra trên macOS arm64 | Không cần cài Git hệ thống để dùng bản ứng dụng này |
| Chuyển lịch sử cũ thành commit Git và hỗ trợ migration lớn | Chưa có | Agent có thể viết công cụ sau khi biết cấu trúc và quy mô dữ liệu cũ |
| Mở từ Finder và cấu hình API | Đã mở bản macOS, có Connection settings và config public | Chưa ký/notarize, chưa kiểm chứng các nền tảng khác |
| Giữ phiên qua lần mở app tiếp theo | Đã kiểm chứng trên bản macOS ngày 19/10 | Phiên mã hóa; bạn chọn cho phép Keychain từng lần, không cần đăng nhập GitHub lại |

Bạn không cần tự sửa các phần code còn thiếu. Các bước dưới đây giúp chạy và kiểm tra phiên bản hiện tại.

## 2. Chuẩn bị trên máy hiện tại

Mở Terminal tại repository:

```sh
cd /Users/dinhviethuy/easy-lateX
node --version
npm --version
git --version
docker info
```

Cần Node >=22, npm >=10 cho môi trường phát triển và Docker đang hoạt động để compile. Dependency Dugite tải Git có kiểm tra checksum khi cài; bộ cài chép Git vào Resources và không phụ thuộc Git trên PATH. Không cần tự cấu hình Git identity, SSH hoặc token.

Cài dependencies nếu chưa cài, rồi chuẩn bị database local:

```sh
npm install
npm run supabase:start
npm run collaboration:setup
```

Hai lệnh cuối dùng cho Supabase local. Nếu dùng database đang vận hành, giữ `DATABASE_URL` của database đó và bỏ bước setup local. Không chạy `supabase db reset` trên database có dữ liệu cần giữ.

Máy hiện tại đã có `.env.local` chứa cấu hình hoạt động. Giữ file đó; không chép đè bằng `.env.example`. Script setup điền các giá trị DB/API còn thiếu hoặc rỗng, giữ cấu hình đã có. Mỗi biến chỉ giữ một dòng.

Kiểm tra compiler:

```sh
npm run compiler:check
```

Nếu image chưa có, chạy `npm run compiler:build`, rồi kiểm tra lại. Không cần cài TeX trên macOS.

## 3. Đăng ký GitHub App — chỉ người quản trị làm một lần

Đăng nhập tài khoản GitHub sẽ quản lý App, mở [Developer settings → GitHub Apps](https://github.com/settings/apps), chọn **New GitHub App**. Chọn tên duy nhất, ví dụ tên ứng dụng kèm hậu tố của bạn. Homepage có thể dùng URL tài khoản GitHub của bạn. Callback local:

```text
http://127.0.0.1:4318/auth/github/callback
```

Bật **Expire user authorization tokens**. Bỏ chọn **Request user authorization (OAuth) during installation** vì code hiện tại tự điều phối bước đăng nhập. Không cần Device Flow hay Setup URL. Trong **Where can this GitHub App be installed?**, chọn **Any account** để tài khoản B cũng cài được. [Cách đăng ký](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [App public/private](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private).

Quyền trong phần **Repository permissions**:

| Quyền | Mức |
| --- | --- |
| Contents | Read & write |
| Administration | Read & write |
| Metadata | Read-only |

Giữ quyền khác ở No access. Contents dùng cho Git qua HTTPS; Administration dùng cho tạo repository và lời mời. [Quyền GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app), [API lời mời](https://docs.github.com/en/rest/collaborators/invitations).

Để nhận webhook khi API chạy trên máy bạn:

1. Mở [smee.io](https://smee.io/), chọn **Start a new channel** và sao chép Webhook Proxy URL.
2. Trong GitHub App, bật **Active**, điền URL Smee vào **Webhook URL**.
3. Sinh một webhook secret bằng `openssl rand -hex 32`; điền cùng giá trị vào GitHub và `GITHUB_WEBHOOK_SECRET` ở backend.
4. Chọn sự kiện **Push**, **Repository**, **Member**. `installation` và `installation_repositories` được gửi tự động, không có ô để đăng ký thủ công. [Sự kiện GitHub](https://docs.github.com/en/webhooks/webhook-events-and-payloads#installation).
5. Chọn **Create GitHub App**.

Smee chỉ dùng thử với project không nhạy cảm: kênh Smee không có xác thực và không dùng cho production. HMAC ở backend vẫn kiểm tra chữ ký, nhưng không làm kênh Smee trở thành kênh riêng tư. [Hướng dẫn webhook của GitHub](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps).

Trong trang settings của App vừa tạo:

- Sao chép **App ID** và **Client ID**. Đây là hai giá trị khác nhau.
- Chọn **Generate a new client secret**, lưu secret vào cấu hình backend.
- Tìm **Private keys → Generate a private key**, lưu file `.pem` tải về. GitHub chỉ giữ phần public của key. [Quản lý private key](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps).
- Mở trang public của App. Ví dụ URL `https://github.com/apps/easy-latex-huy-dev` thì slug là `easy-latex-huy-dev`, không phải toàn URL.

Trong repository, tạo thư mục lưu key:

```sh
mkdir -p .secrets
chmod 700 .secrets
```

Dùng Finder chuyển file vừa tải vào `.secrets`, đổi tên thành `github-app.pem`. Sau đó:

```sh
chmod 600 .secrets/github-app.pem
```

File trong `.secrets` đã được Git ignore. Không gửi secret/private key trong chat và không đưa chúng vào bộ cài desktop.

## 4. Điền biến môi trường

Giữ cấu hình database/API hiện có, bổ sung các dòng sau vào `.env.local`. Thay phần `DIEN_...` bằng giá trị thật:

```dotenv
GITHUB_APP_ID=DIEN_APP_ID
GITHUB_APP_SLUG=DIEN_SLUG
GITHUB_CLIENT_ID=DIEN_CLIENT_ID
GITHUB_CLIENT_SECRET=DIEN_CLIENT_SECRET
GITHUB_CALLBACK_URL=http://127.0.0.1:4318/auth/github/callback
GITHUB_PRIVATE_KEY_PATH=/Users/dinhviethuy/easy-lateX/.secrets/github-app.pem
GITHUB_TOKEN_ENCRYPTION_KEY=DIEN_KHOA_BASE64
GITHUB_WEBHOOK_SECRET=DIEN_SECRET_DA_DAT_TREN_GITHUB
```

Sinh giá trị cho `GITHUB_TOKEN_ENCRYPTION_KEY` bằng:

```sh
openssl rand -base64 32
```

Sao chép nguyên dòng kết quả vào biến. Giữ khóa này ổn định và sao lưu cùng cấu hình backend; đổi tùy tiện sẽ khiến token đã lưu không giải mã được. Webhook secret là giá trị khác, không dùng chung khóa mã hóa.

Cấu hình local cần có:

```dotenv
EASY_LATEX_API_URL=http://127.0.0.1:4318
API_HOST=127.0.0.1
API_PORT=4318
```

`DATABASE_URL` phải trỏ đúng PostgreSQL cần sử dụng. API dùng LISTEN/NOTIFY nên cần direct connection, tránh transaction pooler. Desktop trên máy khác chỉ cần `EASY_LATEX_API_URL` và compiler image; không nhận các secret backend, database password hoặc service-role key. Không dùng `VITE_*` cho secret.

## 5. Migration và chạy thử trên một máy

Nếu dùng database cũ có dữ liệu thật, sao lưu trước khi áp dụng migration. Migration hiện tại bổ sung bảng và thay liên kết danh tính; không xóa source/Storage/history cũ. Database tự dựng ngoài Supabase cần schema collaboration cũ và các role trước, vì script mới không bootstrap một PostgreSQL trống.

Terminal 1, tại repository:

```sh
npm run github:migrate
npm run api:dev
```

API phải báo `Easy LaTeX GitHub collaboration API is ready.` Giữ Terminal này chạy.

Terminal 2, chuyển webhook vào API. Thay URL ví dụ bằng URL Smee thật:

```sh
npx smee-client --url 'https://smee.io/THAY_BANG_CHANNEL_CUA_BAN' --path /github/webhook --port 4318
```

Giữ tiến trình này chạy. GitHub mô tả cách forward và kiểm tra từng bước tại [Testing webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks).

Terminal 3:

```sh
cd /Users/dinhviethuy/easy-lateX
npm run collaboration:check
npm run dev
```

Check thành công chỉ chứng minh cấu hình và `/health`; chưa chứng minh GitHub OAuth/push.

Trong ứng dụng:

1. Chọn **Continue with GitHub**, xác thực trong trình duyệt hệ thống.
2. Khi trang cài App mở, chọn đúng tài khoản cá nhân. Ưu tiên **Only select repositories**.
3. Nếu app báo phải cài đặt, hoàn tất trang GitHub rồi quay lại thử đăng nhập/thao tác một lần nữa; hiện tại không nên giả định cài App xong thì cửa sổ desktop tự hoàn tất mọi bước.
4. Mở một bản sao project nhỏ, chọn **Collaborate**. Thao tác này tạo repository private thật.
5. Nếu GitHub yêu cầu chọn repository mới, mở **GitHub Settings → Applications → Installed GitHub Apps → Configure**, thêm repository mà ứng dụng vừa tạo rồi retry Collaborate trên cùng project.
6. Kiểm tra GitHub có đúng một repository private; mở source, ảnh và PDF tài nguyên để đối chiếu. Chỉnh một file bằng **Edit**, rồi **Done**; GitHub phải có commit mới và app báo xuất bản thành công.
7. Đóng/mở app để kiểm tra giữ phiên; Compile để kiểm tra image/tài nguyên được sử dụng.

## 6. Dùng chung API để thử với hai máy

`127.0.0.1` trên máy B là chính máy B. Hai máy phải dùng cùng API/database. Code desktop chỉ cho HTTPS hoặc HTTP loopback, nên không dùng `http://192.168.x.x:4318`.

Có thể thử bằng ngrok trên máy A; cần tài khoản ngrok của bạn. Nếu có Homebrew, các lệnh theo [ngrok macOS](https://ngrok.com/download/mac-os):

```sh
brew install ngrok
ngrok config add-authtoken 'THAY_BANG_AUTHTOKEN_NGROK'
ngrok http 4318
```

Nếu không dùng Homebrew, tải agent từ trang ngrok. Giữ tunnel chạy và ghi URL HTTPS mà nó hiển thị, ví dụ `https://ten-cua-ban.ngrok.app`.

Thay các giá trị sau trên máy A và trong GitHub App; URL ví dụ phải thay bằng URL thật:

```dotenv
EASY_LATEX_API_URL=https://ten-cua-ban.ngrok.app
GITHUB_CALLBACK_URL=https://ten-cua-ban.ngrok.app/auth/github/callback
```

- GitHub App **Callback URL**: URL callback HTTPS trên.
- GitHub App **Webhook URL**: `https://ten-cua-ban.ngrok.app/github/webhook`. Giữ nguyên webhook secret.
- Có thể dừng Smee khi webhook đã trỏ thẳng vào tunnel.
- Restart API và desktop sau thay đổi cấu hình.
- Trên máy B, chỉ đặt `EASY_LATEX_API_URL=https://ten-cua-ban.ngrok.app` trong cấu hình desktop; không chạy thêm API/Supabase.
- Kiểm tra `/health` trả JSON từ cả hai máy. Nếu URL tunnel đổi, cập nhật cả callback, webhook và API URL trên các desktop.

Có thể chạy dev trên hai máy hoặc dùng bản đóng gói đúng hệ điều hành/kiến trúc. Trong cửa sổ đăng nhập, mở **Connection settings**, lưu URL HTTPS dùng chung, rồi Continue with GitHub. Địa chỉ được giữ sau khi mở lại; cần đăng xuất trước khi đổi server. Khi build, `EASY_LATEX_RELEASE_API_URL=https://API npm run build` nhúng duy nhất URL public vào Resources. Không chép `.env.local` của backend sang desktop khác. Git đã được đóng gói; Docker/compiler image vẫn cần cho compile.

### Checklist hai tài khoản

1. A là chủ project; trong **Collaborate**, mời đúng GitHub username của B, chọn **Can edit**. Không nhập email/display name.
2. Trên máy B, đăng nhập GitHub B trong trình duyệt hệ thống. Cài App nếu được yêu cầu, vào **Projects**, chấp nhận lời mời. Nếu việc chấp nhận trong app bị GitHub từ chối, chấp nhận trên thông báo/email GitHub rồi quay lại làm mới Projects; lưu lại lỗi để sửa tích hợp.
3. A và B mở cùng file rồi bấm Edit gần đồng thời: chỉ một người được sửa.
4. Mỗi người Edit một file khác nhau, sửa rồi Done đồng thời: cả hai thay đổi phải lên GitHub. Desktop tự chờ thử lại có giới hạn khi lượt đang bận; nếu hết lượt thử, giữ bản nháp và dùng Retry Done.
5. Khi B giữ bản nháp, A xuất bản file khác: file đã xuất bản cập nhật, bản nháp B còn nguyên.
6. Dùng GitHub web sửa một file khác và commit. Trong settings GitHub App, xem **Advanced → Recent deliveries**, kiểm tra webhook trả 2xx và desktop nhận thay đổi. Chỉ status 2xx chưa đủ: phải kiểm tra nội dung thực tế đã cập nhật.
7. Ngắt mạng khi đang sửa, nối lại: bản nháp phải còn; đồng bộ và lấy Edit mới trước khi xuất bản.
8. Dừng API trong lúc Done rồi khởi động lại, retry: đối chiếu GitHub để kiểm tra không tạo commit trùng. Thời điểm lỗi ngẫu nhiên không bảo đảm tái hiện đúng cửa sổ push-thành-công/mất-phản-hồi; cần fault injection có kiểm soát để chứng minh trường hợp đó với GitHub thật.
9. Trên repo thử, A vào **Settings → Collaborators**, gỡ B: B không còn được Edit/Done; SSE kiểm tra quyền định kỳ tối đa khoảng 60 giây. Thử revoke quyền App trong GitHub Applications rồi đăng nhập lại.
10. Kiểm tra đường dẫn Project folder trong workspace: sửa và lưu bằng Easy LaTeX phải thay đổi file tại đúng thư mục đó. Thoát dự án, sửa một file đã xuất bản bằng công cụ ngoài rồi mở lại: file phải tự trở về nội dung GitHub trước khi được Edit. Bản nháp tạo trong Easy LaTeX phải còn trong phần phục hồi riêng. Chỉ thử bước ghi đè với dữ liệu mẫu.

GitHub private repository thuộc cá nhân cấp quyền write cho collaborator, nên UI hiện chỉ mời **Can edit**. Muốn read-only thật cần mở rộng cơ chế repository/organization. Đây là giới hạn được thể hiện, không phải ô cấu hình đang bị thiếu. [Quyền repository cá nhân](https://docs.github.com/en/account-and-profile/reference/permission-levels-for-a-personal-account-repository).

Một lượt push không rõ kết quả có thể giữ chỗ đến khi credential hết hạn, khoảng một giờ cộng một phút. Giữ bản nháp, đợi và retry; không tự sửa bảng khóa hay force-push để vượt qua lượt đó.

## 7. Chuyển project cũ

Chỉ cần mục này nếu có dữ liệu từ luồng Supabase cũ. Giữ backup database, Storage và thư mục Git cũ; dừng API/worker cũ nhận chỉnh sửa mới trong lúc chuyển.

Backend mới cần thêm:

```dotenv
LEGACY_SUPABASE_URL=URL_SUPABASE_CU
LEGACY_SUPABASE_ANON_KEY=ANON_KEY_CU
LEGACY_SUPABASE_SERVICE_KEY=SERVICE_ROLE_KEY_CU
```

Lấy các giá trị từ project Supabase cũ; với local, `npx supabase status` hiển thị cấu hình. Service key chỉ ở backend.

Trong Supabase hosted cũ, mở phần Auth/Authentication → Email Templates → Magic Link, bảo đảm email hiển thị mã sáu chữ số bằng `{{ .Token }}`. Mẫu local đã có tại `supabase/templates/legacy-link.html`. [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

Restart API, rồi trong desktop:

1. Đăng nhập GitHub sẽ nhận project.
2. Mở menu tài khoản ở dashboard → **Migrate legacy projects**.
3. Nhập email tài khoản cũ → **Send ownership confirmation**.
4. Nhập OTP nhận được → **Confirm account link**. Với Supabase local, mở giao diện mail local theo địa chỉ mà `supabase status` báo.
5. Chọn một project do tài khoản cũ sở hữu → **Migrate**.
6. Kiểm tra source và tài nguyên trên GitHub, thử compile, xem thư mục `legacy-history-<project-id>`. Mời lại thành viên bằng username GitHub.

Lịch sử per-file có thể đọc được, tác giả và thời gian được giữ trong file `.txt` chứa JSON. Commit SHA cũ và toàn bộ trình tự commit theo project không được tái dựng. Nếu cần chúng, tiếp tục giữ repository/database cũ; chuyển đầy đủ cần một công cụ khác.

Giới hạn hiện tại: 1.000 đường dẫn, 5 MiB/file text, 10 MiB/file binary, 20 MiB tổng mỗi publication, gồm cả bản lưu revision. Vượt giới hạn cần migration theo nhiều đợt; chưa có công cụ tự động cho việc đó. Không xóa bớt lịch sử chỉ để vượt kiểm tra kích thước. Nếu hệ thống cũ không phải schema/database hiện tại của API, cần thêm công cụ import từ hệ thống đó.

## 8. Các việc kỹ thuật agent có thể tiếp tục hoàn thiện

- **Git đã đóng gói:** runtime và giấy phép nằm trong Resources. Đã chạy Git trong bộ cài với PATH rỗng; còn kiểm chứng trên máy sạch/Windows/Linux.
- **Cấu hình bản phát hành đã có:** Connection settings giữ URL qua các lần mở; biến build public cấp địa chỉ mặc định. Bản macOS arm64 đã mở trực tiếp.
- **Migration lớn/lịch sử:** đo số file, byte, revision và khả năng đọc Git cũ; thiết kế nhiều publication có checkpoint; kiểm chứng manifest. Nếu có repository Git cũ đầy đủ, có thể nghiên cứu giữ nguyên commit; nếu chỉ có revision per-file thì không thể cam kết tái tạo đúng commit SHA cũ.
- **Webhook đã sửa:** dùng installation token giới hạn một repository, Contents chỉ đọc; đã kiểm chứng bằng webhook GitHub thật sau khi owner logout.
- **Kiểm thử còn thiếu:** live invitation, hai người sửa cùng lúc, token expiry/recovery có fault injection; Windows/Linux và máy Mac sạch. Live OAuth/push/Done/compile đã qua trên tài khoản hiện tại.

Các mục này cần công việc code/kiểm thử, không được giải quyết chỉ bằng điền `.env`. Bạn chỉ cần cung cấp lựa chọn nền tảng, yêu cầu giữ lịch sử và môi trường kiểm thử; không cần tự lập trình chúng.

## 9. Nếu muốn dùng lâu dài ngoài máy developer

Chưa deploy là đúng phạm vi yêu cầu ban đầu. Khi bạn quyết định triển khai, cần chọn máy chủ, database và domain HTTPS. Trên server:

1. Cài Node >=22, tải đúng source và dependencies.
2. Cấu hình `DATABASE_URL` đến database có schema cũ; giữ backup và chạy `npm run github:migrate` một lần.
3. Đặt các biến GitHub backend và mount file PEM tại đường dẫn server; giữ cùng khóa mã hóa nếu sử dụng database đã có session.
4. Build bằng `npm run build --workspace @easy-latex/api`; chạy `npm run start:built --workspace @easy-latex/api` bằng process manager/service tự restart.
5. Nếu reverse proxy cùng host, API có thể bind `127.0.0.1:4318`; nếu platform/container cần nhận traffic bên ngoài process, đặt `API_HOST=0.0.0.0` và port theo platform.
6. Reverse proxy HTTPS phải giữ SSE `/projects/:id/events`: HTTP/1.1, tắt buffering/cache, timeout đủ dài; kiểm tra nhận sự kiện khi để cửa sổ mở lâu.
7. Đặt GitHub callback `https://DOMAIN/auth/github/callback`, webhook `https://DOMAIN/github/webhook`, và API URL desktop `https://DOMAIN`.
8. Chạy lại checklist hai tài khoản trên endpoint thật. Không dùng Smee làm webhook production hoặc tunnel tạm làm bằng chứng dịch vụ đã vận hành ổn định.

Các thao tác tạo dịch vụ, domain, thanh toán hoặc ký phát hành cần tài khoản/quyền của bạn. Cách bấm cụ thể phụ thuộc nhà cung cấp được chọn; không có thông tin đó để đưa hướng dẫn giao diện chính xác.

## 10. Kiểm tra và xử lý lỗi

| Dấu hiệu | Kiểm tra/cách xử lý |
| --- | --- |
| `Missing configuration` | Bổ sung đúng các tên biến được báo; chạy lại check sau khi API hoạt động |
| `ENOENT` khi đọc PEM | File có tồn tại không, `GITHUB_PRIVATE_KEY_PATH` có phải đường dẫn tuyệt đối không |
| Database connection refused | Docker/Supabase đang chạy, `DATABASE_URL` đúng database và port |
| Callback mismatch/không trở về app | So callback GitHub với `GITHUB_CALLBACK_URL`; restart API; giữ desktop và browser cùng máy |
| Permission/installation error | Kiểm tra App đúng tài khoản, có quyền cần thiết và có chọn repository; cập nhật quyền có thể cần chấp nhận lại |
| B không thấy project | Đúng GitHub username, đã nhận/chấp nhận lời mời, dùng cùng API; chờ dashboard refresh hoặc mở lại |
| Webhook 401 | Hai bên có cùng webhook secret, endpoint nhận raw JSON đúng; không tắt kiểm tra chữ ký |
| Webhook 5xx hoặc không cập nhật | API/tunnel còn chạy, owner có phiên GitHub dùng được; xem cả trạng thái delivery và nội dung desktop |
| Bản nháp còn nhưng không Done được | Đồng bộ bản mới, lấy Edit mới, đối chiếu nội dung; không dùng lại token khóa cũ |
| Bản build mở lên nhưng chưa kết nối | Mở Connection settings và lưu URL API; kiểm tra API đang chạy. Bản build phát hành có thể cấp URL mặc định qua EASY_LATEX_RELEASE_API_URL |
| Đóng/mở app phải đăng nhập lại | Xem thông báo system key store trong cửa sổ đăng nhập. Mở app trực tiếp từ Finder, đăng nhập rồi thoát/mở lại. Nếu macOS yêu cầu Keychain, xử lý trực tiếp yêu cầu cho Easy LaTeX; không gửi mật khẩu máy vào chat. Nếu vẫn chỉ giữ phiên trong bộ nhớ, cần chẩn đoán quyền Keychain và kiểm chứng bản ký ổn định; không dùng plaintext làm cách khắc phục |

Chạy lại kiểm tra tự động khi cần:

```sh
npm run lint
npm run typecheck
npm test
npm run github:test
npm run build
```

`github:test` chỉ nhận database local có quyền tạo database tạm; test PostgreSQL thật nhưng GitHub vẫn giả lập. Nó xóa database thử riêng, không reset database ứng dụng. Thành công ở đây không thay thế checklist live hai tài khoản.

## 10. Keychain và bản macOS local — cập nhật 19/10/2026

Bản build cũ có chữ ký bị mất hiệu lực vì Info.plist/ASAR được cập nhật sau bước ký sớm của fuse plugin. Forge hiện ký ở bước cuối bằng `osxSign`; bản local dùng ad-hoc, đã qua `codesign --verify --deep --strict`. Bản local không bật hardened runtime vì ad-hoc không có Developer ID team; bản dùng `EASY_LATEX_MAC_SIGN_IDENTITY` giữ thiết lập hardened runtime mặc định của bộ ký. Các fuse bảo mật và sandbox renderer vẫn được giữ.

Sau khi mở bản mới:

1. Nếu macOS hỏi quyền truy cập khóa Safe Storage cho đúng ứng dụng Easy LaTeX, tự nhập mật khẩu trực tiếp vào hộp thoại hệ điều hành. Không gửi mật khẩu trong chat hay điền vào màn hình GitHub.
2. “Cho phép” có thể khiến macOS hỏi lại ở lần mở sau. Chọn “Luôn cho phép” cho đúng khóa của ứng dụng nếu muốn tự khôi phục phiên mỗi lần mở app. Không cấp quyền cho mọi ứng dụng hoặc thay đổi quyền các khóa khác.
3. Đăng nhập GitHub, thoát bằng menu **Easy LaTeX → Quit**, rồi mở lại cùng bản build. Đóng riêng cửa sổ trên macOS có thể chưa thoát tiến trình.
4. Nếu từ chối Keychain, app giữ phiên trong bộ nhớ và hiển thị thông báo phải đăng nhập lại sau khi thoát. Không có fallback lưu token plaintext.

Mật khẩu chuỗi khóa login thường là mật khẩu đăng nhập máy; nếu từng đổi mật khẩu thì có thể khác. Xem [hướng dẫn Keychain của Apple](https://support.apple.com/en-gb/guide/keychain-access/kyca2429/mac). Không reset chuỗi khóa chỉ để kiểm thử ứng dụng.

Ad-hoc dùng cho máy phát triển, chưa thay thế Developer ID/notarization. Bản build mới có thể khiến macOS hỏi lại quyền; cần chứng chỉ ký ổn định khi phát hành. [Lưu ý safeStorage của Electron](https://www.electronjs.org/docs/latest/api/safe-storage).

Giao diện đăng nhập, lời mời và chuyển project đã được chỉnh cùng hệ thiết kế dashboard. Migration có bước xem lại project, mô tả archive lịch sử và giữ nguyên dữ liệu gốc. Kiểm thử hai tài khoản thật và chuyển project thật vẫn cần tài khoản/quyền tương ứng.
