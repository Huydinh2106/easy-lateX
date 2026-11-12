# Easy LaTeX trên Supabase Cloud

Kiến trúc mặc định dùng **email và mật khẩu qua Supabase Auth**. Backend chạy trong Edge Function `easy-latex-api`, toàn bộ nội dung project và các phiên bản đã lưu nằm trong Supabase PostgreSQL, tài nguyên nhị phân nằm trong Supabase Storage riêng tư. Không cần tài khoản GitHub, GitHub App, repository, private key hoặc webhook để đăng nhập và làm việc với project cloud.

Cài đặt cloud hiện tại dùng project `rukiacheotxmmrpeppyc` ở Singapore:

- [Supabase Dashboard](https://supabase.com/dashboard/project/rukiacheotxmmrpeppyc)
- [API health](https://rukiacheotxmmrpeppyc.supabase.co/functions/v1/easy-latex-api/health)
- API desktop: `https://rukiacheotxmmrpeppyc.supabase.co/functions/v1/easy-latex-api`

Đây là cài đặt mới theo lựa chọn bỏ qua project cũ. Không cần chạy công cụ chuyển dữ liệu GitHub hoặc legacy để sử dụng app.

Trạng thái triển khai ngày 02/11/2026: backend và database đã qua kiểm tra trực tiếp trên cloud với tài khoản thử nghiệm, bao gồm lưu nguồn, tài nguyên, revision và phân quyền. **SMTP riêng chưa được cấu hình**, nên chưa thể xác nhận gửi thư đăng ký và khôi phục mật khẩu đến người dùng ngoài nhóm quản trị. Cần hoàn tất mục SMTP bên dưới trước khi mở đăng ký rộng rãi.

## Đăng ký, đăng nhập và quên mật khẩu

Trong desktop, mở phần tài khoản để đăng ký bằng email và mật khẩu. Khi project bật xác nhận email, mở thư xác nhận rồi quay lại app để đăng nhập. Liên kết xác nhận kết thúc ở `/auth/confirmed`; trang này chỉ trả thông báo văn bản và không yêu cầu đăng nhập.

**Quên mật khẩu** gửi liên kết đặt lại qua Supabase Auth. Mở thư trên cùng máy đang chạy desktop: liên kết quay về callback HTTP trên `127.0.0.1` với cổng ngẫu nhiên và đường dẫn một lần. Desktop giữ phiên khôi phục trong main process và cho nhập mật khẩu mới; token không được chuyển sang renderer.

Trong **Authentication → URL Configuration** của project, cấu hình:

| Mục | Giá trị |
| --- | --- |
| Site URL | `https://PROJECT_REF.supabase.co/functions/v1/easy-latex-api/auth/confirmed` |
| Redirect URL xác nhận email | Cùng URL `/auth/confirmed` ở trên |
| Redirect URL khôi phục desktop | `http://127.0.0.1:*/auth/recovery/*` |

Bật Email provider và giữ **Confirm email** nếu muốn người dùng xác minh địa chỉ trước khi đăng nhập. Template xác nhận và khôi phục phải chứa liên kết `{{ .ConfirmationURL }}`. Backend chỉ chấp nhận callback khôi phục HTTP trên `127.0.0.1`, cổng cụ thể và đường dẫn `/auth/recovery/` kèm 48 ký tự hex; không chấp nhận chuyển hướng đến website bên ngoài.

Dịch vụ email mặc định của Supabase có giới hạn người nhận và tần suất. Muốn phục vụ người dùng ngoài nhóm quản trị, cấu hình SMTP của project và kiểm tra gửi thư xác nhận/khôi phục đến địa chỉ thực. Xem [hướng dẫn SMTP](https://supabase.com/docs/guides/auth/auth-smtp) và [URL chuyển hướng](https://supabase.com/docs/guides/auth/redirect-urls).

## Dữ liệu và cơ chế lưu

| Thành phần | Nơi lưu |
| --- | --- |
| Tài khoản, mật khẩu, phiên đăng nhập | Supabase Auth |
| Project, thành viên, lời mời theo email | Schema `collaboration` trong PostgreSQL |
| Nội dung `.tex`, `.bib` và tài liệu văn bản | `collaboration.files` |
| Nội dung đầy đủ của mỗi phiên bản đã lưu | `collaboration.revisions` |
| Ảnh, PDF tài nguyên, font và file nhị phân được hỗ trợ | Bucket riêng tư `project-assets`; database lưu khóa object |
| Quyền Edit tạm thời | `collaboration.leases` |
| Thông báo project thay đổi | PostgreSQL `LISTEN/NOTIFY` và SSE có xác thực |

**Edit** cấp quyền sửa cho một người trên mỗi file; các file khác nhau có thể được sửa đồng thời. **Done** cập nhật nội dung, tạo revision và kết thúc lease trong cùng transaction. Gửi lại cùng request Done trả phiên bản đã xác nhận, tránh tạo revision trùng. Backend cloud không đưa snapshot vào hàng đợi Git và không chạy Git worker.

SSE chỉ gửi ID project. Client đọc lại trạng thái có quyền truy cập sau thông báo hoặc khi nối lại. Mỗi stream tự kết thúc trước giới hạn thời gian Edge Runtime, có heartbeat, kiểm tra lại phiên đăng nhập và thành viên, rồi desktop tự nối lại. Không polling nội dung editor theo chu kỳ.

Desktop vẫn cần thư mục làm việc để sửa và biên dịch. Với project cloud, nội dung đã lưu trên Supabase là bản được đồng bộ khi mở project; draft khôi phục được giữ riêng trên máy. Docker và trình biên dịch LaTeX chạy trên desktop. Project local vẫn hoạt động không cần tài khoản hoặc cloud.

## Cấu hình backend

Edge Function dùng các biến riêng được Supabase runtime cấp:

| Biến | Mục đích |
| --- | --- |
| `SUPABASE_URL` | Endpoint Auth và Storage của project |
| `SUPABASE_ANON_KEY` | Gọi các API email/password và xác minh user |
| `SUPABASE_SERVICE_ROLE_KEY` | Truy cập bucket riêng tư từ backend |
| `SUPABASE_DB_URL` | Kết nối PostgreSQL của function |
| `DATABASE_URL` | Tùy chọn thay kết nối mặc định bằng direct hoặc session pooler |
| `EASY_LATEX_DATABASE_CA_BASE64` | Tùy chọn CA certificate riêng khi môi trường cần |

Không đưa service-role key, connection string, mật khẩu hoặc refresh token vào renderer, `VITE_*`, `desktop-config.json` hay Git. Desktop chỉ cần URL API công khai. Phiên đăng nhập được quản lý ở Electron main và lưu qua OS key store khi khả dụng.

Backend gọi `auth.getUser(token)` để xác minh JWT với Supabase Auth, rồi kiểm tra quyền project tại mỗi API. Schema `collaboration` và bucket không được mở trực tiếp cho role `anon` hoặc `authenticated`; các thao tác ghi đều đi qua backend để giữ kiểm tra lease và revision. Gateway JWT verification có thể tắt để các route đăng ký, đăng nhập, refresh và callback công khai hoạt động; các route dữ liệu vẫn tự xác thực và phân quyền.

Kết nối database cần hỗ trợ `LISTEN/NOTIFY`: dùng direct hoặc **Session pooler port 5432**, không dùng Transaction pooler port 6543. Runtime luôn kiểm tra certificate TLS cho kết nối cloud. Xem [tài liệu kết nối PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Triển khai và cập nhật

Nếu Supabase đã kết nối với Codex, dùng connector hiện có để kiểm tra đúng project, áp dụng schema và deploy function. Không cần tạo thêm CLI access token, database password hoặc tải secrets GitHub để cập nhật cài đặt email hiện tại.

Các file nguồn của backend:

- `apps/api/src/supabase-runtime.ts`: Supabase Auth, PostgreSQL, Storage và health check.
- `apps/api/src/supabase-handler.ts`: HTTP API email/project/revision và SSE.
- `apps/api/src/store.ts`: transaction, thành viên, lease và revision.
- `supabase/migrations/`: schema; chỉ áp dụng những migration còn thiếu.
- `supabase/functions/easy-latex-api/index.ts`: điểm vào Edge Function.

Trước khi deploy, chạy:

```sh
npm run typecheck --workspace @easy-latex/api
npm run lint --workspace @easy-latex/api
npm run test --workspace @easy-latex/api
npm run supabase:build
```

Build tạo bundle và import map với phiên bản npm cố định; không đóng gói `.env.local`, filesystem/process runtime hoặc Fastify. Giữ `supabase/config.toml` và function entrypoint trong cùng phiên bản nguồn khi deploy.

Người vận hành đã có Supabase CLI đăng nhập có thể dùng công cụ triển khai email:

```sh
npm run supabase:deploy -- --project-ref PROJECT_REF --dry-run
npm run supabase:deploy -- --project-ref PROJECT_REF
```

Lệnh mặc định build và cập nhật function rồi kiểm tra health; không sao chép hoặc thay đổi dữ liệu. Nó dùng các biến `SUPABASE_*` có sẵn trong runtime và không yêu cầu upload secrets GitHub/Vault.

Với project mới có schema `collaboration` rỗng, có thể thêm `--initialize-db` để áp dụng các migration trong repository. Bước riêng này cần `EASY_LATEX_CLOUD_DATABASE_URL` trỏ đúng direct/session connection của project; không cần đặt biến đó chỉ để deploy lại function. Công cụ từ chối khởi tạo đè lên schema đã có dữ liệu.

Sau khi health báo đúng backend email và database sẵn sàng, có thể kích hoạt URL cho desktop bằng:

```sh
npm run supabase:deploy -- --project-ref PROJECT_REF --activate-desktop
```

Không dùng reset database, prune function hoặc các công cụ chuyển dữ liệu cũ cho thao tác cập nhật thông thường. Các module và tài liệu [GitHub collaboration cũ](COLLABORATION.md) được giữ để tham khảo/khôi phục cài đặt trước; chúng không phải quy trình mặc định của backend email.

## Kết nối desktop và kiểm tra

Đặt các URL công khai sau khi backend đã sẵn sàng:

```dotenv
EASY_LATEX_API_URL=https://PROJECT_REF.supabase.co/functions/v1/easy-latex-api
EASY_LATEX_RELEASE_API_URL=https://PROJECT_REF.supabase.co/functions/v1/easy-latex-api
```

Khởi động lại desktop. Nếu trước đó lưu server riêng trong **Connection settings**, đổi địa chỉ đó vì nó ưu tiên hơn URL mặc định. Muốn bộ cài dùng cloud khi mở từ Finder, build/package lại với `EASY_LATEX_RELEASE_API_URL`.

`GET /health` phải trả `status: "ok"`, `collaboration: "supabase"`, `authentication: "email"`, `database: "ready"`, `runtime: "supabase-edge"`. Health xác nhận runtime/database; vẫn cần thử các luồng sản phẩm:

1. Đăng ký, xác nhận email, đăng nhập và khởi động lại desktop.
2. Tạo project có nguồn, thư mục rỗng và ảnh; mở lại và so sánh nội dung.
3. Edit → Done, xem lịch sử và kiểm tra revision không trùng khi retry.
4. Mời tài khoản email thứ hai, kiểm tra quyền viewer/editor và quyền Edit trên cùng file.
5. Kiểm tra thông báo cập nhật, đăng xuất và quên/đặt lại mật khẩu.

## Khi có lỗi

- **Không nhận thư:** kiểm tra SMTP, giới hạn gửi thư và Authentication logs; kiểm tra template dùng liên kết xác nhận/khôi phục.
- **Liên kết reset không quay về app:** giữ desktop mở trên cùng máy; đối chiếu redirect allowlist và callback `127.0.0.1`.
- **401:** đăng nhập lại hoặc để desktop refresh phiên; backend yêu cầu Supabase JWT, không nhận session GitHub cũ.
- **403:** kiểm tra thành viên và vai trò của project, cùng email nhận lời mời.
- **409 khi Done:** lease hết hạn hoặc đã có phiên bản mới; giữ draft, tải phiên bản đã lưu và xin Edit lại.
- **Live updates ngắt:** desktop tự reconnect; nếu lặp lại, kiểm tra Function Logs và database dùng session/direct connection.
- **Health 503:** kiểm tra schema, kết nối database và certificate; không tắt kiểm tra TLS để vượt lỗi.
