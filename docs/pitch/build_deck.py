"""Generate the editable eight-slide project pitch deck."""
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt


ROOT = Path(__file__).resolve().parent
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
NAVY = RGBColor(17, 31, 53)
RED = RGBColor(226, 59, 63)
WHITE = RGBColor(250, 251, 253)
PALE = RGBColor(216, 225, 236)


def textbox(slide, x, y, w, h, value, size=24, color=WHITE, bold=False):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    frame.margin_left = 0
    frame.margin_top = 0
    frame.margin_right = 0
    for i, line in enumerate(value.split("\n")):
        paragraph = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        paragraph.text = line
        paragraph.font.name = "Aptos"
        paragraph.font.size = Pt(size)
        paragraph.font.bold = bold
        paragraph.font.color.rgb = color
        paragraph.space_after = Pt(16)
    return box


def slide(title, items, footer="Avalanche Fuji · AI Agents & Security"):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = NAVY
    bar = s.shapes.add_shape(1, Inches(0.55), Inches(0.64), Inches(0.11), Inches(0.67))
    bar.fill.solid()
    bar.fill.fore_color.rgb = RED
    bar.line.fill.background()
    textbox(s, 0.85, 0.56, 11.9, 0.9, title, 34, WHITE, True)
    for i, item in enumerate(items):
        textbox(s, 0.9, 1.75 + i * (4.9 / max(len(items), 1)), 11.5,
                4.5 / max(len(items), 1), item, 24 if len(items) < 4 else 21, PALE)
    textbox(s, 0.9, 7.06, 11.5, 0.25, footer, 10, PALE)
    return s


slide("Avalanche Security Triage", [
    "Ưu tiên cảnh báo smart contract theo bằng chứng và ngữ cảnh",
    "AI Agents & Security · Avalanche Fuji Testnet · Chain ID 43113",
])
slide("Vấn đề: quá nhiều cảnh báo để xử lý", [
    "Static checks đưa ra candidates, nhưng mức độ khẩn cấp còn phụ thuộc đường truy cập và tài sản chịu tác động.",
    "Nhóm cần thấy evidence, giới hạn phân tích và lý do xếp thứ tự ngay trong cùng báo cáo.",
])
slide("Giải pháp đang chạy", [
    "Solidity parser tạo candidates cho floating pragma và tx.origin.",
    "Gemini 3.5 Flash-Lite review candidates khi người dùng bật tùy chọn.",
    "Dashboard hiển thị evidence, giới hạn phân tích và đề xuất khắc phục khi có.",
])
slide("Ba trụ cột điểm rủi ro", [
    "Điểm finding = round(0.4 × Exploitability + 0.3 × Exposure + 0.3 × Asset Impact)",
    "Finding floating pragma được 7 điểm từ 10/10/0. Asset Impact là 0 khi chưa xác minh tài sản chịu rủi ro.",
    "Điểm báo cáo lấy mức cao nhất trong các finding potential-issue. Khi nhóm này rỗng, điểm là 0 và dashboard hiển thị —.",
])
slide("Kiến trúc và ranh giới tin cậy", [
    "Dashboard → Express API → static candidates → Gemini review tùy chọn → report snapshot.",
    "Fuji RPC chỉ đọc balance, bytecode và owner/paused nếu contract hỗ trợ.",
    "Backend tính điểm và hash. Người dùng xác nhận giao dịch qua ví, không có private key trên server.",
])
demo = slide("Báo cáo phân tích tĩnh từ API local", [])
demo.shapes.add_picture(str(ROOT / "assets" / "dashboard-report-api.png"),
                        Inches(2.30), Inches(1.65), height=Inches(4.5))
textbox(demo, 1.13, 6.35, 11.1, 0.5,
        "Kết quả API với source mẫu. Finding có điểm 7 và báo cáo đang ở trạng thái chưa đủ điều kiện ghi nhận.",
        16, PALE)
proof = slide("Ghi nhận trên Avalanche Fuji", [
    "Smoke test gọi trực tiếp AvaTriageRegistry và ghi attestation ID 0 tại block 61344940.",
    "Receipt và event AttestationRecorded khớp hash báo cáo đã lưu, score 0 và ipfsUri rỗng.",
    "Dashboard cần finding potential-issue và xác nhận ví để ghi nhận báo cáo đủ điều kiện.",
])
proof_link = textbox(proof, 0.9, 6.40, 11.5, 0.45, "Xem giao dịch smoke trên Fuji", 17, WHITE, True)
proof_link.text_frame.paragraphs[0].runs[0].font.underline = True
proof_link.click_action.hyperlink.address = (
    "https://testnet.snowtrace.io/tx/0xc6e222e40e7c3fa43adfa5583bda1fe9c583c99323234c78a5ab2a3c731cccc4"
)
slide("Giới hạn và bước tiếp", [
    "Hiện mới có hai static checks; source chưa được chứng minh khớp bytecode triển khai.",
    "Mô hình Asset Impact phi tuyến đã được đặc tả, chờ bằng chứng về tài sản chịu rủi ro để tích hợp.",
    "Tiếp theo: mở rộng coverage, xác minh source-address và kiểm thử end-to-end trên môi trường demo.",
])

out = ROOT / "avalanche-security-triage.pptx"
prs.save(out)
print(out)
