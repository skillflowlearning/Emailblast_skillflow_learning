# SkillFlow: tumhe kya setup karna hai

Abhi domains/Workspace/Firebase setup baaki hai. Code simulation mein use ho sakta hai. Accounts apne ownership mein banao; secrets chat ya GitHub par mat bhejna.

## 1. Domains aur independent mailboxes

1. Main website `skillflowlearning.com` alag rakho. Protected live launch ke liye **kam-se-kam 2 independent sending domains** lo, jaise `skillflowlearning.org` aur `skillflowlearning.in`, agar available hon. Third domain baad mein add kar sakte ho. Har sending domain ke liye website banana zaroori nahi; web traffic main website par redirect karo. Mail DNS alag configure honge.
2. Ek Workspace organization mein secondary domains add karo. Domain aliases se independent mailbox/quota nahi milta.
3. Har domain par 3 real team users recommended hain. Har independent user ko Workspace license chahiye. Ek extra licensed user spare rakho: two-domain example mein **6 active + 1 spare**. Spare failed domain par ho toh domain failure mein kaam nahi karega; doosre healthy domain ke active senders pending mail sambhal sakte hain. Per-domain spare stronger redundancy deta hai.
4. Workspace Admin ke exact MX records, ek valid SPF record including `include:_spf.google.com`, DKIM key/signing aur DMARC configure karo. Duplicate SPF mat lagao. App ka default DKIM selector `google` hai; apna selector alag ho toh save karo.
5. Small, relevant, permission-appropriate sending se health establish karo. Sirf 2–3 hafte wait karna inbox placement ka proof nahi hai.

Ek domain par 5–6 accounts ko app 2 domains nahi manega. Mailbox maximum 50/day; domain shared budget default 90/day, configurable maximum 150/day. Extra accounts se domain budget multiply nahi hota. Transfer par bhi quota/window apply hote hain; pending mail ko agle din tak wait karna pad sakta hai.

## 2. Firebase / Google Cloud project

Ek Firebase project banao aur usi Google Cloud project mein Gmail/hosting configure karo.

| Service | Tumhe kya karna hai |
| --- | --- |
| Firebase Authentication | Google sign-in enable; hosted hostname authorized domains mein add |
| Firebase web app | Register karke public Firebase values environment mein lagao |
| Firestore | Default Native database create; repository ke deny-all client rules deploy |
| Gmail API | Enable |
| Google OAuth web client | Client ID + secret create |
| Cloud Run, Tasks, Scheduler | Deployment guide ke steps follow |

Cloud hosting ke liye billing aur budget alert configure karo. Alert spending ko automatically cap nahi karta. Workspace/domain bill alag hai. **Abhi AI ya email-verification API required nahi.**

## 3. Google OAuth

1. Google Auth Platform mein branding, support email aur audience configure karo. Sirf apni Workspace organization ke liye Internal applicable ho sakta hai. Personal Gmail seed/public users ke liye External audience aur applicable review chahiye.
2. Development mein saare sending/seed accounts ko test users mein add karo. External Testing app ke Gmail refresh tokens 7 din mein expire ho sakte hain; production ko testing mode par mat chhodo.
3. **Web application** OAuth client create karo. Exact local redirect URI:

   ```text
   http://localhost:3000/api/google/callback
   ```

4. Hosting ke baad exact HTTPS callback bhi add karo: `https://YOUR-APP-HOST/api/google/callback`. `NEXT_PUBLIC_APP_URL` canonical origin se match hona chahiye.
5. Client ID/secret server environment ya Secret Manager mein lagao. Current flow ke liye DWD private key ya SMTP password nahi chahiye.

Sender connection: `openid`, `email`, `gmail.send`, `gmail.readonly`. Seed connection: identity + `gmail.readonly`. Offline refresh tokens encrypted server storage mein save hote hain; mailbox password app nahi maangta.

`gmail.readonly` restricted scope hai. Public app ko Google verification aur applicable security assessment chahiye ho sakta hai. Privacy policy, verified app domain aur consent disclosure public launch se pehle prepare karo. OAuth UI complete hona Google approval nahi hai.

## 4. App mein connect aur check

1. App aur worker chalao. Production mein Google sign-in karo; local demo apna local saved workspace use karta hai.
2. Domains page par exact sending domains add karo. Har domain ka generated `_mailflow-verify` TXT DNS mein lagao.
3. **Check DNS**: ownership, MX, SPF, DKIM, DMARC pass hon. Checker published records/Google SPF include dekhta hai; complete DNS audit nahi.
4. **Connect sending mailbox**: har Workspace account separately authorize karo. Naye mailboxes paused/unchecked rehte hain.
5. **Connect owned seed inbox**: apna separate Gmail ya Workspace inbox connect karo. Active sender ka same inbox seed nahi hona chahiye. Outlook/Yahoo abhi pending.
6. **Send health probe** real mail bhejta hai, simulation mode mein bhi, sirf connected owned seed ko. Worker 2 minute wait karke exact token/sender/folder check karta hai. Inbox/Promotions pass; spam/missing result activation block. Missing lookup 5 checks tak, 2-minute intervals par retry hoti hai.
7. Healthy senders **Activate**, extra mailbox **Keep as spare** karo. Initial live launch DNS/health freshness 24h; activation/recovery health freshness 1h.
8. Cloud worker/scheduler verify hone ke baad server par `BLAST_PROVIDER_MODE=live` karo. Pehle sirf apne addresses par live test, phir actual logs dekhkar small relevant list.

## Pause / recovery

- Last 3 seed placements mein 2 spam: pehle mailbox pause, domain watch.
- Same domain ke 2 distinct flagged mailboxes: domain pause, us domain ke saare senders block, sirf pending recipients healthy senders/spare ko move.
- **Mailbox 48h, domain 72h** cooldown. Time khatam hote hi automatic send nahi. Fresh passing health test, domain recovery control, explicit mailbox activation/resume chahiye; recovery cap **8/day**.
- Sent/in-flight/uncertain records transfer nahi hote. Healthy capacity khatam toh campaign alert pause.
- Crash/network failure ki uncertain delivery par duplicate-risk hold. Domains ka **Check uncertain deliveries** Gmail Sent mein saved Message-ID dekhta hai. Positive match hi resolve; missing result ko unsent assume nahi karta. Baaki cases operator investigation maangte hain; force-resend button nahi.
- Disconnect stored connection disable karta hai. Google permission revoke karni ho toh Google Account ke Third-party connections mein app remove karo.

Google actual recipient ki spam complaint/folder placement generally expose nahi karta. Seed result signal hai, inbox guarantee nahi. Workspace policy unsolicited mass mail allow nahi karti; Google connection suspension risk ko khatam nahi karta.

## Official references

- [Secondary domains and user licenses](https://support.google.com/a/answer/7502379?hl=en)
- [Google OAuth web flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Refresh-token expiration / Testing mode](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Gmail scopes and verification](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Workspace use policy](https://workspace.google.com/terms/use_policy/)
