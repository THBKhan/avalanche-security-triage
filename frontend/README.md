# Avalanche Triage Dashboard

Run `npm ci` and `npm run dev` in `backend/`, then open http://localhost:3001. The Express service serves `public/` and the API on the same origin. The frontend uses browser-native modules and CSS, with no separate install or frontend environment file.

**Thử dữ liệu mẫu** loads a mock report and an editable Solidity example. **Phân tích** submits the form to the real API. **Tải báo cáo JSON** downloads the currently displayed response. Suggested changes are displayed for review.

The registry address comes from backend configuration. A compatible injected browser wallet must be on Avalanche Fuji and the selected report must be eligible. The wallet flow checks the receipt and the matching registry event before marking a transaction confirmed.

```powershell
node --test frontend/wallet.test.mjs
```
