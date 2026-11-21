# Kịch bản demo 2 phút 30 giây

Đây là kịch bản quay, chưa phải video đã ghi. Dùng địa chỉ/nguồn do nhóm có quyền đánh giá. Fixture có lỗi chỉ chạy trên local Hardhat, không triển khai lên Fuji.

| Thời gian | Màn hình và lời dẫn |
|---|---|
| 00:00–00:30 | Nêu vấn đề: scanner tạo nhiều cảnh báo, nhóm phải chọn cái nào cần xem trước. Giới thiệu dashboard và giới hạn demo. |
| 00:30–01:00 | Bấm **Thử dữ liệu mẫu**, chỉ rõ đây là mock. Sau đó bấm **Phân tích** để chạy API với source mẫu, phân biệt kết quả thật và mock. |
| 01:00–01:30 | Mở finding, xem evidence, điểm E/X/A và `limitations`. Nhấn mạnh AVAX balance chỉ là ngữ cảnh; Asset Impact đang là 0 do chưa xác minh tài sản chịu rủi ro. Nếu có địa chỉ được phép, cho xem truy vấn Fuji chỉ đọc. |
| 01:30–02:00 | Mở diff **AI đề xuất** và nhận xét human review. Nếu báo cáo không có `potential-issue`, chỉ ra score report 0 và vì sao nút attestation khóa. |
| 02:00–02:30 | Nếu có report đủ điều kiện và ví testnet: người dùng xem hash, score, địa chỉ rồi chủ động xác nhận; mở receipt/event trên explorer. Nếu chưa có report phù hợp, mở giao dịch smoke đã ghi trong `contracts/DEPLOYED_ADDRESSES.md` và nói rõ đó là smoke test gọi registry trực tiếp, không phải giao dịch vừa thực hiện trên dashboard. |

Trước khi quay: chạy `npm run validate:schema`, backend build/test, thử flow source/address/RPC lỗi và màn hình mobile; kiểm tra URL, ví Fuji, test AVAX và registry address. Ghi chính xác bản nào là local, mock, RPC live và attestation thật.
