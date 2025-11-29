# main.py - CoinPilotBot v2.0 核心代码（MIT开源
import ccxt
import time
import logging
from datetime import datetime
import json

# ==================== 配置区 ====================
CONFIG = {
    "exchange": "hyperliquid",          # hyperliquid / binance / okx
    "symbol": "BTC/USDT:USDT",          # Hyperliquid用这个格式
    "grid_levels": 15,                  # 网格数量（单边）
    "grid_spacing": 0.008,              # 8‰ 间距（可改成动态）
    "investment_usd": 1000,             # 本金（美元）
    "dca_enabled": True,
    "dca_multiplier": 1.8,              # 马丁格尔倍数
    "api_key": "YOUR_API_KEY",
    "api_secret": "YOUR_API_SECRET",
    "testnet": False,
}

# ==================== 交易所统一封装 ====================
class Exchange:
    def __init__(self):
        if CONFIG["exchange"] == "hyperliquid":
            import hyperliquid
            self.exchange = hyperliquid.Exchange(
                api_key=CONFIG["api_key"],
                api_secret=CONFIG["api_secret"],
                testnet=CONFIG["testnet"]
            )
        elif CONFIG["exchange"] == "binance":
            self.exchange = ccxt.binance({
                'apiKey': CONFIG["api_key"],
                'secret': CONFIG["api_secret"],
                'enableRateLimit': True,
            })
        elif CONFIG["exchange"] == "okx":
            self.exchange = ccxt.okx({
                'apiKey': CONFIG["api_key"],
                'secret': CONFIG["api_secret"],
                'enableRateLimit': True,
            })

    def get_price(self):
        if CONFIG["exchange"] == "hyperliquid":
            ticker = self.exchange.market_data()
            return float(ticker['markPx'])
        else:
            ticker = self.exchange.fetch_ticker(CONFIG["symbol"])
            return ticker['last']

    def place_order(self, side, amount):
        if CONFIG["exchange"] == "hyperliquid":
            return self.exchange.order(
                coin=CONFIG["symbol"].split("/")[0],
                is_buy=(side == "buy"),
                sz=amount,
                limit_px=self.get_price(),
                order_type={"limit": {"tif": "Gtc"}}
            )
        else:
            return self.exchange.create_market_order(CONFIG["symbol"], side, amount)

# ==================== 核心策略 ====================
class CoinPilotBot:
    def __init__(self):
        self.exchange = Exchange()
        self.base_price = None
        self.orders = []

    def init_grid(self):
        price = self.exchange.get_price()
        self.base_price = price
        logging.info(f"基准价格: {price}")

        amount_per_grid = CONFIG["investment_usd"] / (CONFIG["grid_levels"] * 2) / price

        # 买单（低价网格）
        for i in range(1, CONFIG["grid_levels"] + 1):
            buy_price = price * (1 - CONFIG["grid_spacing"] * i)
            self.exchange.place_order("buy", amount_per_grid)
            self.orders.append({"price": buy_price, "side": "buy"})

        # 卖单（高价网格）
        for i in range(1, CONFIG["grid_levels"] + 1):
            sell_price = price * (1 + CONFIG["grid_spacing"] * i)
            self.exchange.place_order("sell", amount_per_grid)
            self.orders.append({"price": sell_price, "side": "sell"})

    def run(self):
        self.init_grid()
        dca_count = 0

        while True:
            try:
                current_price = self.exchange.get_price()
                logging.info(f"{datetime.now()} | 当前价格: {current_price:.2f}")

                # 简单DCA触发：跌破最低买单10%时加仓
                if CONFIG["dca_enabled"] and current_price < self.base_price * 0.85:
                    if dca_count == 0 or current_price < self.base_price * (0.85 ** (dca_count + 1)):
                        add_amount = CONFIG["investment_usd"] * (CONFIG["dca_multiplier"] ** dca_count) / current_price / 100
                        self.exchange.place_order("buy", add_amount)
                        dca_count += 1
                        logging.info(f"第{dca_count}次DCA加仓 {add_amount:.4f} BTC")

                time.sleep(30)  # 30秒轮询
            except Exception as e:
                logging.error(f"错误: {e}")
                time.sleep(10)

# ==================== 启动 ====================
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(message)s')
    bot = CoinPilotBot()
    bot.run()