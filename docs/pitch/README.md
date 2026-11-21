# Pitch deck

`avalanche-security-triage.pptx` là deck 8 slide chỉnh sửa được. Cài `python -m pip install -r docs/pitch/requirements.txt` rồi chạy `python docs/pitch/build_deck.py` để tạo lại. Nội dung bám theo code và tài liệu trong repo; các ví dụ trên slide là minh họa, không phải chứng minh hệ thống đã kiểm toán một contract ngoài đời.

Trước khi trình bày, thay screenshot demo bằng ảnh chụp bản chạy thực tế nếu cần. Không dùng fixture JSON hoặc hash placeholder làm bằng chứng attestation. Giao dịch smoke của registry đã ghi trong `contracts/DEPLOYED_ADDRESSES.md` là giao dịch gọi registry trực tiếp.
