# Asset Impact: mô hình demo đề xuất

## Trạng thái triển khai

Backend hiện dùng `assetImpact = 0` khi dựng report, kể cả lúc RPC đọc được `balanceAvax`. Đây là **giá trị thay thế cho dữ liệu chưa xác minh**, không phải kết luận tài sản bằng 0. `docs/mock-data.json` là dữ liệu minh họa cấu trúc API, không phải một lần đo Fuji hoặc báo cáo có thể ghi lên registry.

## Đề xuất khi đã có bằng chứng tài sản chịu rủi ro

Cho `b` là số AVAX **đã xác minh có thể chịu tác động bởi đúng finding**. Thang phi tuyến demo:

`AssetImpact(b) = min(100, round(25 × log2(1 + b)))`, với `b ≥ 0`.

| AVAX chịu rủi ro đã xác minh | Điểm demo |
|---:|---:|
| 0 | 0 |
| 1 | 25 |
| 3 | 50 |
| 15 | 100 |

Đây là thang đo minh họa, chưa được hiệu chỉnh bằng tổn thất thực tế, thanh khoản, token price hoặc mức độ có thể rút vốn. `balanceAvax` của một địa chỉ không tự chứng minh `b`. Token ERC-20, tài sản ở hợp đồng khác, proxy, quyền truy cập, pausability và liên kết source-bytecode cần bằng chứng riêng. Nếu thiếu bất kỳ mắt xích cốt yếu nào, giữ `assetImpact = 0` và ghi trạng thái **unverified** trong `limitations`/`liveContext.note`; không suy diễn “không có rủi ro”.

## Điều kiện để tích hợp về sau

1. Xác minh chain ID, block/time, địa chỉ và source tương ứng với bytecode đang chạy.
2. Xác định finding ảnh hưởng tới tài sản nào, đường khai thác có thể chuyển bao nhiêu, và nguồn số liệu cho từng tài sản.
3. Lưu provenance, đơn vị, block/time, trạng thái thiếu dữ liệu và lý do chọn `b` cùng report snapshot.
4. Rà soát schema/API với nhóm trước khi thêm trường; backend là nơi duy nhất tính, làm tròn và hash điểm cuối cùng.

Ngưỡng severity và công thức report hiện hành nằm trong [kiến trúc](../ARCHITECTURE.md); không thay đổi theo đề xuất này.
