#!/usr/bin/env python3
"""The Reef Bot - Safe farming"""
import requests, time, random, sys, os

API = os.getenv("REEF_API_URL", "https://thereef.co")
KEY = os.getenv("REEF_API_KEY")
if not KEY:
    print("Error: REEF_API_KEY environment variable required")
    sys.exit(1)
HDR = {"Content-Type": "application/json", "X-API-Key": KEY}

def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

def act(body, retries=3):
    for _ in range(retries):
        try:
            r = requests.post(f"{API}/action", json=body, headers=HDR, timeout=30)
            d = r.json()
            if "Rate limit" in d.get("error", ""):
                time.sleep(d.get("retryAfterSec", 3) + 1)
                continue
            log(f"{'✓' if d.get('success') else '✗'} {body['action']}: {d.get('narrative','')[:70]}...")
            return d
        except Exception as e:
            log(f"✗ {e}")
            time.sleep(5)
    return {"success": False}

def run():
    log("=== BOT START ===")
    c = 0
    while True:
        c += 1
        log(f"\n--- {c} ---")
        
        s = act({"action": "look"})
        time.sleep(6)
        if not s.get("success"): time.sleep(10); continue
        
        a = s.get("agent", {})
        hp, mhp = a.get("hp", 0), a.get("maxHp", 100)
        en, men = a.get("energy", 0), a.get("maxEnergy", 50)
        zone = a.get("location", "shallows")
        inv = s.get("inventory", [])
        inv_count = sum(i.get("quantity", 0) for i in inv)
        
        log(f"HP:{hp}/{mhp} E:{en}/{men} Zone:{zone} Inv:{inv_count}/10")
        
        # Dead? Rest
        if not a.get("isAlive", True) or hp == 0:
            log("💀 Resting")
            act({"action": "rest"}); time.sleep(65); continue
        
        # Combat? Flee
        if "IN COMBAT" in s.get("narrative", ""):
            log("⚔️ Flee")
            act({"action": "flee"}); time.sleep(6); continue
        
        # Low HP/Energy? Rest
        if hp < mhp * 0.4 or en < 15:
            log(f"Rest (HP:{hp} E:{en})")
            act({"action": "rest"}); time.sleep(65); continue
        
        # Inventory full? Sell
        if inv_count >= 8:
            log("📦 Selling")
            if zone != "trading_post":
                act({"action": "move", "target": "trading_post"})
                time.sleep(6)
            for item in inv[:3]:
                act({"action": "sell", "target": item["resource"]})
                time.sleep(6)
            continue
        
        # Random actions
        r = random.random()
        if r < 0.4:
            # Gather
            narr = s.get("narrative", "")
            res = []
            if "Seaweed" in narr: res.append("seaweed")
            if "Sand Dollars" in narr: res.append("sand_dollars")
            if res:
                log(f"Gather {res[0]}")
                act({"action": "gather", "target": res[0]})
                time.sleep(6)
        elif r < 0.7:
            # Move
            other = "trading_post" if zone == "shallows" else "shallows"
            log(f"Move {other}")
            act({"action": "move", "target": other})
            time.sleep(6)
        elif r < 0.85:
            log("Quest")
            act({"action": "quest", "target": "list"})
            time.sleep(6)
        else:
            log("Status")
            act({"action": "status"})
            time.sleep(6)
        
        w = random.randint(10, 20)
        log(f"Wait {w}s")
        time.sleep(w)

if __name__ == "__main__":
    try: run()
    except KeyboardInterrupt: log("Stop")
    except Exception as e: log(f"ERR: {e}"); sys.exit(1)
