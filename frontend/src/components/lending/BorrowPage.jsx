import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3Context } from '../../context/Web3Context';
import { LENDING_ADDRESSES, NETWORK_CONFIG } from '../../config/lendingContracts';
import { LENDING_POOL_ABI, ERC20_ABI } from '../../config/lendingAbis';

const readProvider = new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrl);

const TOKENS = [
  { address: LENDING_ADDRESSES.Stablecoin, symbol: 'C5D',  icon: '💵', color: 'blue'   },
  { address: LENDING_ADDRESSES.MockWETH,   symbol: 'WETH', icon: '⚡', color: 'purple' },
];

function fmt(val, d = 4) {
  if (val === undefined || val === null) return '—';
  const n = Number(ethers.formatEther(val));
  return n === 0 ? '0' : n.toFixed(d);
}

function fmtPct(val) {
  if (!val) return '0.00%';
  return (Number(ethers.formatEther(val)) * 100).toFixed(2) + '%';
}

function fmtUSD(val) {
  if (!val) return '$0.00';
  return '$' + Number(ethers.formatEther(val)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function HealthMeter({ hf }) {
  if (!hf) return null;
  const isMax = hf >= ethers.MaxUint256 / 2n;
  if (isMax) return (
    <div className="mt-3">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">Health Factor</span>
        <span className="text-green-600 font-bold">∞ (No Debt)</span>
      </div>
      <div className="h-2 rounded-full bg-green-400"></div>
    </div>
  );

  const val = Number(ethers.formatEther(hf));
  const pct = Math.min(val / 3, 1) * 100; // cap at 3x for visual
  const color = val >= 2 ? 'bg-green-400' : val >= 1.2 ? 'bg-yellow-400' : 'bg-red-400';
  const textColor = val >= 2 ? 'text-green-600' : val >= 1.2 ? 'text-yellow-600' : 'text-red-600';

  return (
    <div className="mt-3">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">Health Factor</span>
        <span className={`font-bold ${textColor}`}>{val.toFixed(3)}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: pct + '%' }}></div>
      </div>
      <div className="text-xs text-gray-400 mt-1">
        {val < 1 ? '⚠ Below 1.0 — liquidation risk!' : val < 1.5 ? '⚠ Low — add collateral or repay' : '✓ Healthy'}
      </div>
    </div>
  );
}

export default function BorrowPage() {
  const { signer, account, isConnected } = useWeb3Context();

  const [tab, setTab]                 = useState('borrow');
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [amount, setAmount]           = useState('');
  const [loading, setLoading]         = useState(false);
  const [msg, setMsg]                 = useState({ text: '', type: '' });
  const [overview, setOverview]       = useState(null);
  const [tokenData, setTokenData]     = useState({});

  const loadData = useCallback(async () => {
    if (!isConnected || !account) return;
    try {
      const pool = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);

      const [totalCollateralUSD, totalDebtUSD, healthFactor] = await Promise.all([
        pool.getTotalCollateralUSD(account),
        pool.getTotalDebtUSD(account),
        pool.getHealthFactor(account),
      ]);
      setOverview({ totalCollateralUSD, totalDebtUSD, healthFactor });

      const data = {};
      for (const t of TOKENS) {
        const erc = new ethers.Contract(t.address, ERC20_ABI, readProvider);
        const [walletBal, borrowBal, maxBorrow, borrowAPY, supplyBal, price] = await Promise.all([
          erc.balanceOf(account),
          pool.getBorrowBalance(account, t.address),
          pool.getMaxBorrow(account, t.address),
          pool.getBorrowAPY(t.address),
          pool.getSupplyBalance(account, t.address),
          pool.tokenPricesUSD(t.address),
        ]);
        data[t.address] = { walletBal, borrowBal, maxBorrow, borrowAPY, supplyBal, price };
      }
      setTokenData(data);
    } catch (e) {
      console.error('BorrowPage load error:', e);
    }
  }, [account, isConnected]);

  useEffect(() => { loadData(); }, [loadData]);

  const setMax = () => {
    const d = tokenData[selectedToken.address];
    if (!d) return;
    if (tab === 'borrow') {
      setAmount(ethers.formatEther(d.maxBorrow));
    } else {
      setAmount(ethers.formatEther(d.borrowBal));
    }
  };

  const handleAction = async () => {
    if (!amount || Number(amount) <= 0) {
      setMsg({ text: '❌ Please enter a valid amount', type: 'error' });
      return;
    }

    setLoading(true);
    setMsg({ text: '', type: '' });

    try {
      const pool      = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, signer);
      const erc       = new ethers.Contract(selectedToken.address, ERC20_ABI, signer);
      const ercRead   = new ethers.Contract(selectedToken.address, ERC20_ABI, readProvider);
      const amountWei = ethers.parseEther(amount);

      if (tab === 'borrow') {
        setMsg({ text: '⏳ Borrowing tokens…', type: 'info' });
        const tx = await pool.borrow(selectedToken.address, amountWei);
        await tx.wait();
        setMsg({ text: `✅ Successfully borrowed ${amount} ${selectedToken.symbol}!`, type: 'success' });

      } else {
        // Repay: need to approve first
        setMsg({ text: '⏳ Step 1/2: Approving token transfer…', type: 'info' });
        const allowance = await ercRead.allowance(account, LENDING_ADDRESSES.LendingPool);
        if (allowance < amountWei) {
          const approveTx = await erc.approve(LENDING_ADDRESSES.LendingPool, amountWei);
          await approveTx.wait();
        }

        setMsg({ text: '⏳ Step 2/2: Repaying debt…', type: 'info' });
        const tx = await pool.repay(selectedToken.address, amountWei);
        await tx.wait();
        setMsg({ text: `✅ Successfully repaid ${amount} ${selectedToken.symbol}!`, type: 'success' });
      }

      setAmount('');
      loadData();
    } catch (e) {
      console.error(e);
      setMsg({ text: '❌ ' + (e.reason || e.message?.slice(0, 120)), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-20 text-gray-500">
        Please connect your wallet to use the borrowing protocol.
      </div>
    );
  }

  const d = tokenData[selectedToken.address];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Borrow</h1>
        <p className="text-gray-500 text-sm mt-1">
          Borrow against your collateral. Maintain Health Factor above 1.0 to avoid liquidation.
        </p>
      </div>

      {/* Position Overview */}
      {overview && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Position Overview</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Total Collateral</div>
              <div className="font-bold text-blue-600 text-lg">{fmtUSD(overview.totalCollateralUSD)}</div>
            </div>
            <div>
              <div className="text-gray-500">Total Debt</div>
              <div className="font-bold text-orange-600 text-lg">{fmtUSD(overview.totalDebtUSD)}</div>
            </div>
          </div>
          <HealthMeter hf={overview.healthFactor} />
        </div>
      )}

      {/* Over-collateralization explanation */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Over-Collateralization:</strong> You must deposit more collateral than you borrow.
        E.g., deposit $1000 WETH → borrow up to $750 C5D (LTV 75%).
        If health factor drops below 1.0, your position can be liquidated.
      </div>

      {/* Token Borrow Cards */}
      <div className="grid grid-cols-2 gap-4">
        {TOKENS.map((t) => {
          const td = tokenData[t.address];
          return (
            <button
              key={t.address}
              onClick={() => setSelectedToken(t)}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                selectedToken.address === t.address
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{t.icon}</span>
                <span className="font-bold text-lg">{t.symbol}</span>
              </div>
              <div className="text-sm text-gray-600">
                Borrow APY: <span className="text-orange-600 font-semibold">{fmtPct(td?.borrowAPY)}</span>
              </div>
              <div className="text-sm text-gray-600">
                Your debt: <span className="font-medium text-orange-700">{fmt(td?.borrowBal, 4)} {t.symbol}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                Max borrow: {fmt(td?.maxBorrow, 4)} {t.symbol}
              </div>
            </button>
          );
        })}
      </div>

      {/* Action Panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Tabs */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          {['borrow', 'repay'].map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(''); setMsg({ text: '', type: '' }); }}
              className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'borrow' ? '💳 Borrow' : '↩ Repay'}
            </button>
          ))}
        </div>

        {/* Token selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Asset to {tab}</label>
          <div className="flex gap-2">
            {TOKENS.map((t) => (
              <button
                key={t.address}
                onClick={() => setSelectedToken(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  selectedToken.address === t.address
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {t.icon} {t.symbol}
              </button>
            ))}
          </div>
        </div>

        {/* Balance Info */}
        <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-600">
            <span>Wallet balance</span>
            <span className="font-medium">{fmt(d?.walletBal)} {selectedToken.symbol}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Current debt (+ interest)</span>
            <span className="font-medium text-orange-700">{fmt(d?.borrowBal)} {selectedToken.symbol}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Max borrowable (by LTV)</span>
            <span className="font-medium text-blue-600">{fmt(d?.maxBorrow)} {selectedToken.symbol}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Borrow APY</span>
            <span className="font-medium text-orange-600">{fmtPct(d?.borrowAPY)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Token price</span>
            <span className="font-medium">{fmtUSD(d?.price)}</span>
          </div>
        </div>

        {/* Amount input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            <button
              onClick={setMax}
              className="px-3 py-3 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-medium"
            >
              MAX
            </button>
          </div>
          {tab === 'borrow' && amount && d?.maxBorrow && (
            <div className="text-xs text-gray-500 mt-1">
              Using {Math.min(100, (Number(amount) / Number(ethers.formatEther(d.maxBorrow))) * 100).toFixed(1)}% of available credit
            </div>
          )}
        </div>

        {/* Risk warning for borrow */}
        {tab === 'borrow' && (
          <div className="text-xs text-gray-500 bg-orange-50 rounded-lg p-3">
            ⚠ Borrowing increases your debt. If asset prices change or interest accrues,
            your Health Factor may drop. Keep HF well above 1.0 to stay safe.
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleAction}
          disabled={loading || !amount}
          className="w-full py-3 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? 'Processing…'
            : tab === 'borrow'
              ? `Borrow ${amount || '0'} ${selectedToken.symbol}`
              : `Repay ${amount || '0'} ${selectedToken.symbol}`}
        </button>

        {/* Message */}
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

      {/* LTV / Liquidation Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Risk Parameters</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b">
                <th className="text-left py-2">Asset</th>
                <th className="text-right py-2">Max LTV</th>
                <th className="text-right py-2">Liq. Threshold</th>
                <th className="text-right py-2">Your Collateral</th>
                <th className="text-right py-2">Your Debt</th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((t) => {
                const td = tokenData[t.address];
                return (
                  <tr key={t.address} className="border-b last:border-0">
                    <td className="py-2">{t.icon} {t.symbol}</td>
                    <td className="text-right py-2 text-gray-600">75–80%</td>
                    <td className="text-right py-2 text-gray-600">80–85%</td>
                    <td className="text-right py-2 text-green-700">{fmt(td?.supplyBal, 2)}</td>
                    <td className="text-right py-2 text-orange-700">{fmt(td?.borrowBal, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          <strong>LTV (Loan-to-Value)</strong>: Max you can borrow relative to collateral value.<br />
          <strong>Liquidation Threshold</strong>: If debt exceeds this % of collateral, liquidation occurs.
        </p>
      </div>
    </div>
  );
}
