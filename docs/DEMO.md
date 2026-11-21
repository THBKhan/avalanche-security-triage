# Demo và triển khai

## Chạy local

Cài Node.js 24 và npm. Từ thư mục gốc:

```powershell
npm ci --prefix backend
npm --prefix backend run dev
```

Mở http://localhost:3001. Chọn **Thử dữ liệu mẫu**, mở finding và xem diff minh họa. Bấm **Phân tích** để tạo báo cáo bằng analyzer tĩnh, kiểm tra điểm, evidence, phạm vi, rồi tải JSON. Xóa mã và chỉ nhập một địa chỉ Fuji để thử chế độ đọc ngữ cảnh.

Điểm demo dùng trọng số 40/30/30, làm tròn một lần ở backend và lấy điểm cao nhất trong các finding được review là `potential-issue`. Nếu không có finding đủ điều kiện, điểm báo cáo là 0, giao diện hiển thị dấu gạch và nút ghi nhận bị khóa. Asset Impact là 0 khi chưa xác minh được tài sản có rủi ro. Số dư AVAX được hiển thị riêng.

## Kết nối ngoài

| Cấu hình backend | Công dụng |
|---|---|
| `PORT` | Cổng HTTP, mặc định 3001. |
| `FUJI_RPC_URL` | URL RPC đọc Avalanche Fuji, có mặc định trong ứng dụng. |
| `LLM_PROVIDER=gemini`, `LLM_MODEL`, `LLM_API_KEY` | Bật lựa chọn gửi mã nguồn cho Gemini trên form. Có thể để trống để chỉ dùng phân tích tĩnh. Chỉ bật trên môi trường có giới hạn truy cập phù hợp với quota dữ liệu và chi phí. |
| `REGISTRY_ADDRESS` | Địa chỉ `AvaTriageRegistry` đã xác minh trên Fuji. Khi trống, báo cáo vẫn có hash và nút ghi nhận bị khóa. |
| `ENABLE_FUJI_SMOKE_TEST=true` | Hiện nút chuẩn bị smoke test cho registry Fuji của dự án. Mặc định tắt. |
| `REPORT_SNAPSHOT_DIR` | Thư mục riêng để lưu snapshot có evidence. Mặc định `backend/.report-snapshots`; cấu hình ổ đĩa bền khi deploy. |
| `CORS_ORIGIN` | Origin được phép gọi API. Đặt origin HTTPS đầy đủ của demo khi host chấm dứt TLS tại reverse proxy. |

Chạy `npm run smoke:gemini -- --live` từ `backend/` khi ba biến Gemini đã được cấu hình. Script gửi đúng một mẫu Solidity cố định và chỉ in kết quả rút gọn.

Để kiểm thử ghi nhận thật, dùng một registry đã xác minh và một hợp đồng demo an toàn mà nhóm có quyền rà soát. Nhập mã nguồn và địa chỉ tương ứng, dùng review Gemini và kiểm tra có finding `potential-issue`, đối chiếu báo cáo, score và hash, xác nhận trong ví Fuji rồi xem giao dịch. Chỉ khi receipt thành công có event khớp, dashboard mới hiển thị đã ghi nhận. Xem [địa chỉ triển khai](../contracts/DEPLOYED_ADDRESSES.md).

### Smoke test ví với registry Fuji

Bật `ENABLE_FUJI_SMOKE_TEST=true` và đặt `REGISTRY_ADDRESS` thành địa chỉ registry Fuji trong tài liệu triển khai. Bấm **Chuẩn bị smoke test Fuji**. Backend đối chiếu mã nguồn, chain ID và bytecode của registry, rồi lưu báo cáo tĩnh điểm 0 có ghi mục đích kiểm thử trong snapshot. Bấm **Ghi smoke test trên Fuji**, đối chiếu hash và xác nhận trong ví. Nút **Ghi nhận trên Fuji** của báo cáo thông thường vẫn yêu cầu finding `potential-issue`.

Video quay luồng smoke test từ dashboard qua MetaMask trên Edge. Dashboard xác nhận receipt và event khớp snapshot cho attestation ID `2`, điểm `0`, block `61432183`. [Xem giao dịch trong video](https://testnet.snowtrace.io/tx/0x35ba960515587bf1ab1e974eac7bef5a2184f88c5a2be3529a40ee4ce6b10e23).

## Đóng gói

```powershell
docker build -t avalanche-triage .
docker volume create avalanche-triage-reports
docker run --rm -p 3001:3001 -v avalanche-triage-reports:/data avalanche-triage
```

Phục vụ chung dashboard/API trên cổng `3001`. Cấu hình health check `GET /health`, TLS tại nền tảng hosting, và mount volume cho `/data`. Truyền tùy chọn Gemini/registry qua cấu hình bí mật của host. Snapshot lưu dưới dạng JSON canonical với tên `0x<hash>.json`; thư mục này không được phục vụ qua HTTP.

Snapshot có thể chứa trích đoạn mã. Chỉ cấp quyền đọc cho người vận hành cần đối chiếu, và đặt chính sách lưu trữ theo phạm vi demo. Xác minh mã băm từ báo cáo đã tải bằng `npm --prefix backend run verify:report -- <đường-dẫn-json>`. Có thể thêm hash từ explorer làm tham số cuối để đối chiếu với giao dịch.

## Kiểm thử

```powershell
npm ci
npm run validate:schema
npm --prefix backend run build
npm --prefix backend test
node --test frontend/wallet.test.mjs
```
