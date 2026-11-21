# Kịch bản video demo

[Video demo 2:16](avalanche-security-triage-demo.mp4) ghi màn hình dashboard, MetaMask và Snowtrace trong Microsoft Edge, có phụ đề tiếng Việt.

| Thời gian | Thao tác trên màn hình |
|---|---|
| 00:00–00:23 | Bấm **Thử dữ liệu mẫu**, rồi bấm **Phân tích** để chạy kiểm tra tĩnh qua API với source mẫu. |
| 00:23–01:10 | Dán mã `DemoGuard` và bật Gemini review. Xem bằng chứng, ba thành phần của điểm 60, khuyến nghị và giới hạn phân tích. |
| 01:10–01:27 | Tra cứu riêng địa chỉ registry để xem số dư, thời điểm đọc và 3.030 byte bytecode qua RPC Fuji. |
| 01:27–01:53 | Mở báo cáo smoke test, đối chiếu địa chỉ, điểm và hash rồi bấm **Confirm** trong MetaMask. Dashboard xác nhận registry đã ghi nhận báo cáo. |
| 01:53–02:16 | Mở giao dịch trên Snowtrace, xem **Success** và đối chiếu hash của attestation ID `2` trong **Logs**. |

Trước khi quay, kiểm tra backend, dashboard, cấu hình Gemini và registry. Video dùng báo cáo tĩnh của registry để kiểm thử chữ ký ví và đối chiếu receipt. [Giao dịch smoke test trong video](https://testnet.snowtrace.io/tx/0x35ba960515587bf1ab1e974eac7bef5a2184f88c5a2be3529a40ee4ce6b10e23).
