# Steem Witness Price Feed Publisher

Publishes STEEM/SBD price feeds for Steem witnesses by fetching the STEEM price from CoinGecko and broadcasting via the Steem network.

## Requirements

- **Node.js 18+** (uses native `fetch`)

## Setup & Installation

```bash
git clone https://github.com/DoctorLai/pricefeed.git pricefeed
cd pricefeed
npm install
```

Update `config.json` with your witness account name and private active key (see Configuration below). Alternatively, set them as environment variables.

### Run in background with PM2

```bash
sudo npm install pm2 -g
pm2 start feed.js
pm2 logs feed
pm2 save
```

### Run in Docker

1. **Build the image:**

```bash
docker build -t pricefeed .
```

2. **Run the container (mounting your local config.json):**

On **Linux / macOS**:

```bash
docker run -itd \
    --name pricefeed \
    -v $(pwd)/config.json:/app/config.json \
    pricefeed
```

On **Windows (PowerShell)**:

```powershell
docker run -itd \
    --name pricefeed \
    -v ${PWD}/config.json:/app/config.json \
    pricefeed
```

3. **Monitor the logs:**

```bash
docker logs -f pricefeed
```

## Configuration

Edit `config.json`:

```jsonc
{
  "rpc_nodes": [
    // List of Steem RPC nodes (cycles through on failure)
    "https://api.steemit.com",
    "https://api.moecki.online",
    "https://api.justyy.com",
  ],
  "feed_steem_account": "", // Your Steem witness account name (or set env var)
  "feed_steem_active_key": "", // Private active key (or set env var)
  "exchanges": ["coingecko"], // Price source
  "interval": 60, // Minutes between feed publishes
  "price_feed_max_retry": 5, // Max retries for price API calls
  "retry_interval": 10, // Seconds between retries
  "peg_multi": 1, // Feed bias (quote = 1 / peg_multi)
}
```

### Environment Variables

Config keys can also be set as environment variables with the same name:

```bash
export feed_steem_account="yourwitness"
export feed_steem_active_key="5K..."
```

## Troubleshooting

### `RPCError: unknown key:unknown key:`

If you see this error when broadcasting the price feed, it means the blockchain node rejected the transaction. This is almost always caused by one of two things:

1. **Incorrect Active Key:** You provided an invalid private active key or used your _posting_ key by mistake. Double-check your private active key.
2. **Account is Not a Witness:** The publishing account must be registered as a witness on the Steem blockchain. If you have not run a `witness_update` transaction to register your account as a witness, the blockchain nodes will reject the `feed_publish` transaction with this error.

## License

MIT
