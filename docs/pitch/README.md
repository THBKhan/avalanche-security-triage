# Pitch deck

`avalanche-security-triage.pptx` là deck 8 slide chỉnh sửa được. Cài `python -m pip install -r docs/pitch/requirements.txt` rồi chạy `python docs/pitch/build_deck.py` để tạo lại. Nội dung bám theo code và tài liệu trong repo; các ví dụ trên slide là minh họa, không phải chứng minh hệ thống đã kiểm toán một contract ngoài đời.

Slide 7 dùng giao dịch smoke test ký từ dashboard qua MetaMask, cùng giao dịch được xác minh trong video demo. Link Snowtrace mở receipt và Logs để đối chiếu attestation ID, hash và điểm trên Fuji.

Slide 6 dùng `assets/dashboard-report-api.png`, ảnh chụp khi API local đã phân tích source mẫu. Screenshot hiển thị finding floating pragma, evidence và ba điểm thành phần. Video demo nằm trong `docs/demo`.
