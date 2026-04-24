> 2026-04-23 update
>
> Dispatch is now built in by default in ecom-agent-platform.
> DISPATCH_AGENT_ENABLED defaults to enabled; set it to false only when you want to disable dispatch routes.
>
# 璋冩嫧 Agent 鍚敤涓庤繍琛?
## 鐜鍙橀噺

鍏ㄩ儴鍙€?鏈缃椂鏈夐粯璁ゅ€笺€傚彧闇€瑕佽 `DISPATCH_AGENT_ENABLED=true` 鍗冲彲鍚敤銆?
| 鍙橀噺 | 榛樿鍊?| 璇存槑 |
|---|---|---|
| `DISPATCH_AGENT_ENABLED` | `false` | 鎬诲紑鍏?`true` 鏃舵敞鍐岃矾鐢便€佽彍鍗曘€佹潈闄愭ā鍧?|
| `DISPATCH_DATA_DIR` | `<repo>/data/dispatch` | 浠诲姟鏁版嵁鐩綍(SQLite + 涓婁紶 + 浜х墿) |
| `DISPATCH_SAAS_PUBLIC_URL` | `http://localhost:3000` | 鐢熸垚閽夐拤鍗＄墖纭閾炬帴鐢?灞€鍩熺綉濉?`http://<鏈満IP>:3000` |
| `DISPATCH_DINGTALK_WEBHOOK_URL` | 绌?| 閽夐拤鏈哄櫒浜?webhook;鏈厤缃椂璺宠繃閽夐拤,鏃堕棿杞撮噷鍙洿鎺ョ偣"鎵撳紑纭椤? |
| `DISPATCH_DINGTALK_SECRET` | 绌?| 閽夐拤鍔犵瀵嗛挜(鍙€? |
| `DISPATCH_CONFIRM_TIMEOUT_MS` | `14400000`(4h) | 绛夊緟闇€姹備汉纭鐨勮秴鏃舵椂闂?|

## Windows 鍚敤姝ラ

1. 鎵撳紑 PowerShell(绠＄悊鍛?,杩涘叆浠撳簱鐩綍

2. **棣栨**:瀹夎鏂颁緷璧?`better-sqlite3` 瑕佺紪璇戜竴娆?
   ```powershell
   npm run install:all
   ```
   鐪嬪埌 `node-gyp` 瀛楁牱鏄甯哥殑銆傚鏋滄姤閿欐彁绀虹己 Python/VS Build Tools,瑁呭ソ鍚庨噸璺戙€?
3. 璁剧幆澧冨彉閲?寤鸿鍐欏埌 `ops/windows/start_all.ps1` 鍚姩鍓?鎴栬€呯敤 `.env`):
   ```powershell
   $env:DISPATCH_AGENT_ENABLED = "true"
   $env:DISPATCH_DINGTALK_WEBHOOK_URL = "https://oapi.dingtalk.com/robot/send?access_token=..."
   $env:DISPATCH_SAAS_PUBLIC_URL = "http://<浣犳湰鏈篒P>:3000"
   ```

4. 鍚姩(鍓嶇鏋勫缓 + 缃戝叧璧锋潵):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\start_all.ps1 -RebuildWeb
   ```

5. 鐧诲綍鍚庤繘鍏?`/dispatch` 鑿滃崟(闇€瑕佺鐞嗗憳鏉冮檺鎴栧崟鐙负璐︽埛鎺堜簣 `dispatch` 妯″潡鏉冮檺)銆?
## 鍏抽棴鍔熻兘(鍥炲埌鍘熺姸鎬?

```powershell
$env:DISPATCH_AGENT_ENABLED = "false"
```
閲嶅惎缃戝叧鍗冲彲,鍏ㄩ儴璺敱銆佽彍鍗曘€佹潈闄愭ā鍧楅兘浼氭秷澶?鐜版湁绯荤粺琛屼负涓庢湭鍔犲姛鑳藉墠 100% 涓€鑷淬€?
## 缁欏悓浜嬭处鎴峰紑閫氭潈闄?
绠＄悊鍛樼櫥褰?鈫?鍙充笂"璐﹀彿鏉冮檺" 鈫?缂栬緫鍚屼簨璐︽埛 鈫?鍕鹃€?璋冩嫧"妯″潡 鈫?淇濆瓨銆?
## 鏁呴殰鎺掓煡

- 鍚姩鏃剁湅鍒?`[dispatch] DISPATCH_AGENT_ENABLED=false, 宸茶烦杩囪皟鎷?Agent 娉ㄥ唽`
  鈫?鐜鍙橀噺娌＄敓鏁?妫€鏌?PowerShell 鏄惁璁惧埌浜嗗悓涓€ session
- `better-sqlite3` 缂栬瘧澶辫触
  鈫?瑁?Visual Studio Build Tools(C++ 妗岄潰寮€鍙戝伐浣滆礋杞?,瑁呭畬閲嶅惎鍐嶈窇 `npm run install:all`
- 閽夐拤娑堟伅鏀朵笉鍒?  鈫?纭缇ゆ満鍣ㄤ汉"鍔犵"鎴?鍏抽敭璇?鏍￠獙鏄惁鍖归厤,webhook 閲屽甫鐨勫叧閿瘝鏄?璋冩嫧"
- 纭椤垫墦寮€鎻愮ず `token_invalid_or_expired`
  鈫?token 榛樿 24 灏忔椂鏈夋晥鏈?涓斿彧鑳芥彁浜や竴娆°€傝繃鏈熻鍦?SaaS 鏃堕棿杞翠笂鐩存帴鎵撳紑鏂伴摼鎺?


