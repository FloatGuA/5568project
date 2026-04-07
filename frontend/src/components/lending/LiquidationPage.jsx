import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3Context } from '../../context/Web3Context';
import { LENDING_ADDRESSES, NETWORK_CONFIG } from '../../config/lendingContracts';
import { LENDING_POOL_ABI, ERC20_ABI } from '../../config/lendingAbis';

const readProvider = new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrl);

const TOKENS = [
  { address: LENDING_ADDRESSES.Stablecoin, symbol: 'C5D',  icon: '💵' },
  { address: LENDING_ADDRESSES.MockWETH,   symbol: 'WETH', icon: '⚡' },
];

// Standard Hardhat local accounts (first 10)
const KNOWN_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
  '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
];

function fmt(val, d = 4) {
  if (val === undefined || val === null) return '—';
  const n = Number(ethers.formatEther(val));
  return n === 0 ? '0' : n.toFixed(d);
}

function fmtUSD(val) {
  if (!val) return '$0.00';
  return '$' + Number(ethers.formatEther(val)).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function shortAddr(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function HFBadge({ hf }) {
  if (!hf && hf !== 0n) return <span className="text-gray-400">—</span>;
  const isMax = hf >= ethers.MaxUint256 / 2n;
  if (isMax) return <span className="text-green-600 font-bold">∞</span>;
  const val = Number(ethers.formatEther(hf));
  const color = val < 1 ? 'text-red-600 bg-red-50' : val < 1.5 ? 'text-yellow-600 bg-yellow-50' : 'text-green-600 bg-green-50';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      {val.toFixed(3)}
    </span>
  );
}

export default function LiquidationPage() {
  const { signer, account, isConnected } = useWeb3Context();

  const [positions, setPositions]         = useState([]);
  const [scanning, setScanning]           = useState(false);
  const [selected, setSelected]           = useState(null);   // borrower address
  const [debtToken, setDebtToken]         = useState(TOKENS[0]);
  const [collToken, setCollToken]         = useState(TOKENS[1]);
  const [repayAmt, setRepayAmt]           = useState('');
  const [expectedSeize, setExpectedSeize] = useState(null);
  const [loading, setLoading]             = useState(false);
  const [msg, setMsg]                     = useState({ text: '', type: '' });

  // ── Scan all known accounts for HF and positions ──────────────────
  const scanPositions = useCallback(async () => {
    setScanning(true);
    try {
      const pool = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);
      const results = await Promise.all(
        KNOWN_ACCOUNTS.map(async (addr) => {
          const [hf, collUSD, debtUSD] = await Promise.all([
            pool.getHealthFactor(addr),
            pool.getTotalCollateralUSD(addr),
            pool.getTotalDebtUSD(addr),
          ]);
          // Per-token debt/collateral
          const tokenData = {};
          for (const t of TOKENS) {
            const [supplyBal, borrowBal] = await Promise.all([
              pool.getSupplyBalance(addr, t.address),
              pool.getBorrowBalance(addr, t.address),
            ]);
            tokenData[t.address] = { supplyBal, borrowBal };
          }
          return { addr, hf, collUSD, debtUSD, tokenData };
        })
      );
      // Only show accounts that have any position
      setPositions(results.filter(p => p.debtUSD > 0n || p.collUSD > 0n));
    } catch (e) {
      console.error('Scan error:', e);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { scanPositions(); }, [scanPositions]);

  // ── Recalculate expected collateral seize when inputs change ──────
  useEffect(() => {
    const calc = async () => {
      if (!repayAmt || Number(repayAmt) <= 0 || !selected) {
        setExpectedSeize(null);
        return;
      }
      try {
        const pool       = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);
        const debtPrice  = await pool.tokenPricesUSD(debtToken.address);
        const collPrice  = await pool.tokenPricesUSD(collToken.address);
        const repayWei   = ethers.parseEther(repayAmt);
        // collateralSeized = repayAmount * debtPrice * 105 / collateralPrice / 100
        const seized = repayWei * debtPrice * 105n / collPrice / 100n;
        setExpectedSeize(seized);
      } catch {
        setExpectedSeize(null);
      }
    };
    calc();
  }, [repayAmt, debtToken, collToken, selected]);

  // ── Set max repay (50% of borrower's debt in selected token) ──────
  const setMaxRepay = async () => {
    if (!selected) return;
    try {
      const pool    = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);
      const debt    = await pool.getBorrowBalance(selected, debtToken.address);
      const maxWei  = debt * 50n / 100n;
      setRepayAmt(ethers.formatEther(maxWei));
    } catch (e) {
      console.error(e);
    }
  };

  // ── Execute liquidation ───────────────────────────────────────────
  const handleLiquidate = async () => {
    if (!selected || !repayAmt || Number(repayAmt) <= 0) {
      setMsg({ text: 'Please select a borrower and enter repay amount.', type: 'error' });
      return;
    }
    if (debtToken.address === collToken.address) {
      setMsg({ text: 'Debt token and collateral token must be different.', type: 'error' });
      return;
    }

    setLoading(true);
    setMsg({ text: '', type: '' });

    try {
      const repayWei  = ethers.parseEther(repayAmt);
      const poolAddr  = LENDING_ADDRESSES.LendingPool;
      const pool      = new ethers.Contract(poolAddr, LENDING_POOL_ABI, signer);
      const erc       = new ethers.Contract(debtToken.address, ERC20_ABI, signer);
      const ercRead   = new ethers.Contract(debtToken.address, ERC20_ABI, readProvider);

      // Step 1: Approve
      setMsg({ text: 'Step 1/2: Approving token transfer…', type: 'info' });
      const allowance = await ercRead.allowance(account, poolAddr);
      if (allowance < repayWei) {
        const tx = await erc.approve(poolAddr, repayWei);
        await tx.wait();
      }

      // Step 2: Liquidate
      setMsg({ text: 'Step 2/2: Executing liquidation…', type: 'info' });
      const tx = await pool.liquidate(selected, debtToken.address, repayWei, collToken.address);
      const receipt = await tx.wait();

      // Parse Liquidated event for exact seized amount
      const iface = new ethers.Interface(LENDING_POOL_ABI);
      let seizedAmt = expectedSeize;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === 'Liquidated') seizedAmt = parsed.args.collateralSeized;
        } catch {}
      }

      setMsg({
        text: `Liquidation successful! Repaid ${repayAmt} ${debtToken.symbol}, received ${fmt(seizedAmt)} ${collToken.symbol} (+5% bonus).`,
        type: 'success',
      });
      setRepayAmt('');
      setSelected(null);
      setExpectedSeize(null);
      scanPositions();
    } catch (e) {
      console.error(e);
      setMsg({ text: e.reason || e.message?.slice(0, 150), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const liquidatable = positions.filter(p => {
    const isMax = p.hf >= ethers.MaxUint256 / 2n;
    return !isMax && p.hf < ethers.parseEther('1');
  });
  const healthy = positions.filter(p => {
    const isMax = p.hf >= ethers.MaxUint256 / 2n;
    return isMax || p.hf >= ethers.parseEther('1');
  });

  const selectedPos = positions.find(p => p.addr.toLowerCase() === selected?.toLowerCase());

  if (!isConnected) {
    return (
      <div className="text-center py-20 text-gray-500">
        Please connect your wallet to use the liquidation page.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Liquidations</h1>
        <p className="text-gray-500 text-sm mt-1">
          When a borrower's Health Factor drops below 1.0, their position can be liquidated.
          Liquidators repay up to 50% of the debt and receive collateral at a 5% discount.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 space-y-1">
        <div className="font-semibold">Liquidation Rules</div>
        <div className="grid grid-cols-3 gap-4 mt-2 text-xs">
          <div className="bg-white rounded-lg p-3 border border-red-100">
            <div className="font-bold text-red-700 text-base">HF &lt; 1.0</div>
            <div className="text-gray-600">Required to liquidate</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-red-100">
            <div className="font-bold text-red-700 text-base">50%</div>
            <div className="text-gray-600">Max debt repayable (close factor)</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-red-100">
            <div className="font-bold text-red-700 text-base">+5%</div>
            <div className="text-gray-600">Bonus collateral for liquidator</div>
          </div>
        </div>
      </div>

      {/* Positions table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-800">
            All Positions
            {liquidatable.length > 0 && (
              <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                {liquidatable.length} liquidatable
              </span>
            )}
          </h2>
          <button
            onClick={scanPositions}
            disabled={scanning}
            className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 flex items-center gap-1"
          >
            {scanning ? 'Scanning…' : 'Refresh'}
          </button>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            {scanning ? 'Scanning accounts…' : 'No active positions found.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-gray-500 text-xs uppercase">
                <th className="text-left px-5 py-3">Account</th>
                <th className="text-right px-4 py-3">Health Factor</th>
                <th className="text-right px-4 py-3">Collateral (USD)</th>
                <th className="text-right px-4 py-3">Debt (USD)</th>
                <th className="text-right px-4 py-3">C5D debt</th>
                <th className="text-right px-4 py-3">WETH debt</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {/* Liquidatable first */}
              {[...liquidatable, ...healthy].map((pos) => {
                const isLiquidatable = pos.hf < ethers.parseEther('1') && pos.hf < ethers.MaxUint256 / 2n;
                const isSelected = selected?.toLowerCase() === pos.addr.toLowerCase();
                return (
                  <tr
                    key={pos.addr}
                    className={`transition-colors ${isSelected ? 'bg-orange-50' : isLiquidatable ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-5 py-3 font-mono text-xs text-gray-700">
                      {shortAddr(pos.addr)}
                      {pos.addr.toLowerCase() === account?.toLowerCase() && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-1.5 rounded">you</span>
                      )}
                    </td>
                    <td className="text-right px-4 py-3"><HFBadge hf={pos.hf} /></td>
                    <td className="text-right px-4 py-3 text-gray-700">{fmtUSD(pos.collUSD)}</td>
                    <td className="text-right px-4 py-3 text-gray-700">{fmtUSD(pos.debtUSD)}</td>
                    <td className="text-right px-4 py-3 text-orange-700">
                      {fmt(pos.tokenData[LENDING_ADDRESSES.Stablecoin]?.borrowBal, 2)}
                    </td>
                    <td className="text-right px-4 py-3 text-purple-700">
                      {fmt(pos.tokenData[LENDING_ADDRESSES.MockWETH]?.borrowBal, 4)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isLiquidatable && pos.addr.toLowerCase() !== account?.toLowerCase() && (
                        <button
                          onClick={() => {
                            setSelected(pos.addr);
                            setMsg({ text: '', type: '' });
                            // Auto-select debt token (the one with actual debt)
                            const c5dDebt = pos.tokenData[LENDING_ADDRESSES.Stablecoin]?.borrowBal ?? 0n;
                            const wethDebt = pos.tokenData[LENDING_ADDRESSES.MockWETH]?.borrowBal ?? 0n;
                            if (c5dDebt > wethDebt) {
                              setDebtToken(TOKENS[0]);
                              setCollToken(TOKENS[1]);
                            } else {
                              setDebtToken(TOKENS[1]);
                              setCollToken(TOKENS[0]);
                            }
                            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                          }}
                          className="px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium"
                        >
                          Liquidate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Liquidation Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="font-semibold text-gray-800">Execute Liquidation</h2>

        {/* Borrower address */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Borrower Address</label>
          <input
            type="text"
            value={selected ?? ''}
            onChange={(e) => { setSelected(e.target.value); setMsg({ text: '', type: '' }); }}
            placeholder="0x… (select from table above or paste address)"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          {selectedPos && (
            <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
              <span>HF: <HFBadge hf={selectedPos.hf} /></span>
              <span>Collateral: {fmtUSD(selectedPos.collUSD)}</span>
              <span>Debt: {fmtUSD(selectedPos.debtUSD)}</span>
            </div>
          )}
        </div>

        {/* Token selectors */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Debt Token (you repay)</label>
            <div className="flex gap-2">
              {TOKENS.map((t) => (
                <button
                  key={t.address}
                  onClick={() => {
                    setDebtToken(t);
                    if (t.address === collToken.address) setCollToken(TOKENS.find(x => x.address !== t.address));
                    setRepayAmt('');
                  }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                    debtToken.address === t.address
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t.icon} {t.symbol}
                </button>
              ))}
            </div>
            {selectedPos && (
              <div className="mt-1 text-xs text-gray-500">
                Borrower's {debtToken.symbol} debt:{' '}
                <span className="font-medium text-orange-600">
                  {fmt(selectedPos.tokenData[debtToken.address]?.borrowBal, 4)}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Collateral Token (you receive)</label>
            <div className="flex gap-2">
              {TOKENS.map((t) => (
                <button
                  key={t.address}
                  onClick={() => {
                    setCollToken(t);
                    if (t.address === debtToken.address) setDebtToken(TOKENS.find(x => x.address !== t.address));
                  }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                    collToken.address === t.address
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t.icon} {t.symbol}
                </button>
              ))}
            </div>
            {selectedPos && (
              <div className="mt-1 text-xs text-gray-500">
                Borrower's {collToken.symbol} collateral:{' '}
                <span className="font-medium text-green-600">
                  {fmt(selectedPos.tokenData[collToken.address]?.supplyBal, 4)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Repay amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Repay Amount</label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.001"
              value={repayAmt}
              onChange={(e) => setRepayAmt(e.target.value)}
              placeholder="0.0"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <button
              onClick={setMaxRepay}
              disabled={!selected}
              className="px-4 py-3 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-medium disabled:opacity-40"
            >
              50% MAX
            </button>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Maximum repay = 50% of borrower's debt in the selected token (close factor)
          </div>
        </div>

        {/* Expected output */}
        {expectedSeize !== null && repayAmt && Number(repayAmt) > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
            <div className="font-semibold text-green-800 mb-2">Expected Outcome</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-gray-500 text-xs">You pay</div>
                <div className="font-bold text-red-600">{repayAmt} {debtToken.symbol}</div>
              </div>
              <div>
                <div className="text-gray-500 text-xs">You receive (+5% bonus)</div>
                <div className="font-bold text-green-600">{fmt(expectedSeize, 6)} {collToken.symbol}</div>
              </div>
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleLiquidate}
          disabled={loading || !selected || !repayAmt || Number(repayAmt) <= 0}
          className="w-full py-3 bg-red-500 text-white rounded-lg font-semibold hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Processing…' : `Liquidate — Repay ${repayAmt || '0'} ${debtToken.symbol}`}
        </button>

        {/* Status message */}
        {msg.text && (
          <div className={`text-sm p-3 rounded-lg ${
            msg.type === 'error'   ? 'bg-red-50 text-red-700' :
            msg.type === 'success' ? 'bg-green-50 text-green-700' :
                                     'bg-blue-50 text-blue-700'
          }`}>
            {msg.text}
          </div>
        )}
      </div>
    </div>
  );
}
