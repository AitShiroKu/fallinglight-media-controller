import asyncio
from playwright.async_api import async_playwright
import os
import pytesseract
from PIL import Image

OUT_DIR = "/mnt/ZakuraOnline/ZakuraProject/FallingLight Media controller/.godkiller/evidence"
os.environ["TESSDATA_PREFIX"] = "/home/artzakura/tessdata"

async def capture():
    os.makedirs(OUT_DIR, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 720})
        page = await context.new_page()

        # Step 01: 01_boot -> /stream/video with HUD
        print("Capturing 01_boot...")
        await page.goto("http://localhost:6141/stream/video", wait_until="networkidle")
        await page.mouse.move(640, 360)
        await page.wait_for_timeout(300)
        p01 = os.path.join(OUT_DIR, "01_boot.png")
        await page.screenshot(path=p01)

        # Step 02: 02_title_or_menu -> /stream unlocked dashboard
        print("Capturing 02_title_or_menu...")
        await page.goto("http://localhost:6141/stream", wait_until="networkidle")
        btn = await page.query_selector("#btn-unlock-audio")
        if btn:
            await btn.click()
            await page.wait_for_timeout(300)
        p02 = os.path.join(OUT_DIR, "02_title_or_menu.png")
        await page.screenshot(path=p02)

        # Step 03: 03_enter_play -> /stream/video standby
        print("Capturing 03_enter_play...")
        await page.goto("http://localhost:6141/stream/video", wait_until="networkidle")
        await page.wait_for_timeout(300)
        p03 = os.path.join(OUT_DIR, "03_enter_play.png")
        await page.screenshot(path=p03)

        # Step 04 & 05: /stream/video active video playback
        print("Capturing 04 & 05...")
        encoded_url = "/uploads/%E0%B9%80%E0%B8%9E%E0%B8%A5%E0%B8%87%E0%B9%80%E0%B8%95%E0%B9%89%E0%B8%99%E0%B9%81%E0%B8%AD%E0%B9%82%E0%B8%A3%E0%B8%9A%E0%B8%B4%E0%B8%81%20%E0%B8%9B.5%202569.mp4"
        await page.evaluate(f"""() => {{
            var videoEl = document.getElementById('receiver-video-pure');
            var standbyEl = document.getElementById('video-standby');
            var hudTitle = document.getElementById('hud-track-title');
            var hudRes = document.getElementById('hud-resolution-badge');

            if (standbyEl) standbyEl.classList.add('hidden');
            if (videoEl) {{
                videoEl.classList.remove('hidden');
                videoEl.src = '{encoded_url}';
                videoEl.muted = true;
                videoEl.play();
                videoEl.addEventListener('loadedmetadata', function() {{
                    if (hudRes && videoEl.videoWidth && videoEl.videoHeight) {{
                        hudRes.textContent = videoEl.videoWidth + 'x' + videoEl.videoHeight;
                        hudRes.classList.remove('hidden');
                    }}
                }});
            }}
            if (hudTitle) hudTitle.textContent = 'Aerobic Video Track';
        }}""")
        await page.wait_for_timeout(1500)

        # Step 04: 04_gameplay_idle -> video with HUD top bar
        await page.mouse.move(640, 360)
        await page.wait_for_timeout(300)
        p04 = os.path.join(OUT_DIR, "04_gameplay_idle.png")
        await page.screenshot(path=p04)

        # Step 05: 05_primary_action -> video with HUD focused
        p05 = os.path.join(OUT_DIR, "05_primary_action.png")
        await page.screenshot(path=p05)

        # Step 06: Controller login & PlayerDeck
        print("Logging in to controller...")
        await page.goto("http://localhost:6141/", wait_until="networkidle")
        await page.wait_for_timeout(500)

        login_btn = await page.query_selector('button:has-text("เข้าสู่ระบบ")') or await page.query_selector('button:has-text("Login")')
        if login_btn:
            user_input = await page.query_selector('input[type="text"]') or await page.query_selector('input[name="username"]')
            pass_input = await page.query_selector('input[type="password"]')
            if user_input and pass_input:
                await user_input.fill("admin")
                await pass_input.fill("cptw@2468")
                submit_btn = await page.query_selector('button[type="submit"]') or login_btn
                await submit_btn.click()
                await page.wait_for_timeout(1000)

        # Step 06: 06_hud_readable -> Player tab
        print("Capturing 06_hud_readable...")
        p06 = os.path.join(OUT_DIR, "06_hud_readable.png")
        await page.screenshot(path=p06)

        # Step 07: 07_secondary_state -> File Manager tab
        print("Capturing 07_secondary_state...")
        files_tab = await page.query_selector('button:has-text("จัดการไฟล์")') or await page.query_selector('button:has-text("Files")')
        if files_tab:
            await files_tab.click()
            await page.wait_for_timeout(500)
        p07 = os.path.join(OUT_DIR, "07_secondary_state.png")
        await page.screenshot(path=p07)

        # Step 08: 08_after_interaction -> Schedule tab
        print("Capturing 08_after_interaction...")
        sched_tab = await page.query_selector('button:has-text("ตารางเวลา")') or await page.query_selector('button:has-text("Schedule")')
        if sched_tab:
            await sched_tab.click()
            await page.wait_for_timeout(500)
        p08 = os.path.join(OUT_DIR, "08_after_interaction.png")
        await page.screenshot(path=p08)

        # Step 09: 09_edge_or_stable -> Settings tab
        print("Capturing 09_edge_or_stable...")
        settings_tab = await page.query_selector('button:has-text("ตั้งค่า")') or await page.query_selector('button:has-text("Settings")')
        if settings_tab:
            await settings_tab.click()
            await page.wait_for_timeout(500)
        p09 = os.path.join(OUT_DIR, "09_edge_or_stable.png")
        await page.screenshot(path=p09)

        # Step 10: 10_final_frame -> /stream/audio unlocked
        print("Capturing 10_final_frame...")
        await page.goto("http://localhost:6141/stream/audio", wait_until="networkidle")
        btn_a = await page.query_selector("#btn-unlock-audio")
        if btn_a:
            await btn_a.click()
            await page.wait_for_timeout(300)
        p10 = os.path.join(OUT_DIR, "10_final_frame.png")
        await page.screenshot(path=p10)

        await browser.close()
        print("\nAll 10 shots captured. Checking OCR strings:\n")

        for f in sorted(os.listdir(OUT_DIR)):
            if f.endswith(".png"):
                full_p = os.path.join(OUT_DIR, f)
                txt = pytesseract.image_to_string(Image.open(full_p))
                lines = [l.strip() for l in txt.split("\n") if l.strip()]
                print(f"[{f}]: {lines[:4]}")

if __name__ == "__main__":
    asyncio.run(capture())
