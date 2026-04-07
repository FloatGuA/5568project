import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3Context } from '../../context/Web3Context';
import { LENDING_ADDRESSES, NETWORK_CONFIG } from '../../config/lendingContracts';
import { LENDING_POOL_ABI, ERC20_ABI } from '../../config/lendingAbis';

// Read-only provider talks directly to Hardhat — bypasses MetaMask for view calls
const readProvider = new ethers.JsonRpcProvider(NETWORK_CONFIG.rpcUrl);

const PRECISION = ethers.parseEther('1'); // 1e18

// Token metadata
const TOKEN_META = {
  [LENDING_ADDRESSES.Stablecoin?.toLowerCase()]: { symbol: 'C5D',  color: 'blue',   icon: '💵' },
  [LENDING_ADDRESSES.MockWETH?.toLowerCase()]:    { symbol: 'WETH', color: 'purple', icon: '⚡' },
};

function fmt(val, decimals = 4) {
  if (val === undefined || val === null) return '—';
  const n = Number(ethers.formatEther(val));
  if (n === 0) return '0';
  if (n > 1e9) return '∞';
  return n.toFixed(decimals);
}

function fmtPct(val) {
  // val is a fraction of 1e18 representing a rate (e.g. 0.05 * 1e18 = 5%)
  if (!val) return '0.00%';
  const pct = Number(ethers.formatEther(val)) * 100;
  return pct.toFixed(2) + '%';
}

function fmtUSD(val) {
  if (!val) return '$0.00';
  const n = Number(ethers.formatEther(val));
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function HealthBadge({ hf }) {
  if (!hf) return <span className="text-gray-400">—</span>;
  const val = Number(ethers.formatEther(hf));
  const isMax = hf >= ethers.MaxUint256 / 2n;
  if (isMax) return <span className="text-green-600 font-bold text-lg">∞ (No Debt)</span>;
  const color = val >= 2 ? 'text-green-600' : val >= 1.2 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`font-bold text-lg ${color}`}>{val.toFixed(3)}</span>;
}

function StatCard({ title, value, sub, color = 'gray' }) {
  const colors = {
    blue:   'bg-blue-50 border-blue-200 text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    red:    'bg-red-50 border-red-200 text-red-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    gray:   'bg-gray-50 border-gray-200 text-gray-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="text-sm font-medium opacity-75">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { signer, account, isConnected } = useWeb3Context();

  const [loading, setLoading]       = useState(false);
  const [userData, setUserData]     = useState(null);
  const [markets, setMarkets]       = useState([]);
  const [walletBals, setWalletBals] = useState({});
  const [claimMsg, setClaimMsg]     = useState('');

  const loadData = useCallback(async () => {
    if (!isConnected || !account) return;
    setLoading(true);
    try {
      // Use read-only provider for all view calls (bypasses MetaMask issues)
      const pool = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);
      const tokens = [
        { address: LENDING_ADDRESSES.Stablecoin, ...TOKEN_META[LENDING_ADDRESSES.Stablecoin?.toLowerCase()] },
        { address: LENDING_ADDRESSES.MockWETH,   ...TOKEN_META[LENDING_ADDRESSES.MockWETH?.toLowerCase()]   },
      ];

      // Load market data
      const marketData = await Promise.all(
        tokens.map(async (t) => {
          const [supplyBal, borrowBal] = await Promise.all([
            pool.getSupplyBalance(account, t.address),
            pool.getBorrowBalance(account, t.address),
          ]);
          const [totalSupplied, totalBorrowed, utilizationRate, supplyAPY, borrowAPY, price] =
            await pool.getMarketData(t.address);
          const config = await pool.tokenConfigs(t.address);
          return {
            ...t,
            supplyBal, borrowBal,
            totalSupplied, totalBorrowed,
            utilizationRate, supplyAPY, borrowAPY, price,
            ltv: config.ltv, liqThreshold: config.liquidationThreshold,
          };
        })
      );
      setMarkets(marketData);

      // User summary
      const [totalCollateralUSD, totalDebtUSD, healthFactor] = await Promise.all([
        pool.getTotalCollateralUSD(account),
        pool.getTotalDebtUSD(account),
        pool.getHealthFactor(account),
      ]);
      setUserData({ totalCollateralUSD, totalDebtUSD, healthFactor });

      // Wallet balances (read-only, no signer needed)
      const bals = {};
      for (const t of tokens) {
        const erc = new ethers.Contract(t.address, ERC20_ABI, readProvider);
        bals[t.address] = await erc.balanceOf(account);
      }
      setWalletBals(bals);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }, [signer, account, isConnected]);

  useEffect(() => { loadData(); }, [loadData]);

  const claimFaucet = async (tokenAddress, symbol) => {
    try {
      setClaimMsg('');
      const erc = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await erc.faucet();
      await tx.wait();
      setClaimMsg(`✅ Claimed test ${symbol}!`);
      loadData();
    } catch (e) {
      setClaimMsg('❌ ' + (e.reason || e.message));
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🏦</div>
        <h2 className="text-2xl font-bold text-gray-700 mb-2">COMP5568 Lending Protocol</h2>
        <p className="text-gray-500">Please connect your MetaMask wallet to continue</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Your lending &amp; borrowing position overview</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Position Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Collateral"
          value={fmtUSD(userData?.totalCollateralUSD)}
          sub="Value of supplied assets"
          color="blue"
        />
        <StatCard
          title="Total Debt"
          value={fmtUSD(userData?.totalDebtUSD)}
          sub="Outstanding borrow balance"
          color="red"
        />
        <StatCard
          title="Net Position"
          value={fmtUSD(
            userData
              ? userData.totalCollateralUSD - userData.totalDebtUSD
              : undefined
          )}
          sub="Collateral minus debt"
          color="green"
        />
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-500">Health Factor</div>
          <div className="mt-1"><HealthBadge hf={userData?.healthFactor} /></div>
          <div className="text-xs text-gray-400 mt-1">
            {userData?.healthFactor
              ? (Number(ethers.formatEther(userData.healthFactor)) < 1e9
                  ? '< 1.0 = liquidation risk'
                  : 'No debt — safe')
              : '—'}
          </div>
        </div>
      </div>

      {/* Health Factor Explanation */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <strong>Health Factor (HF)</strong> = (Collateral × Liquidation Threshold) / Total Debt.
        &nbsp; HF ≥ 2.0 → Safe &nbsp;|&nbsp; 1.0–2.0 → Monitor &nbsp;|&nbsp; &lt; 1.0 → Liquidation Risk
      </div>

      {/* Market Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Markets</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-gray-500 font-medium">Asset</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Price</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Total Supplied</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Total Borrowed</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Utilization</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Supply APY</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Borrow APY</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">LTV / Liq.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {markets.map((m) => (
                <tr key={m.address} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{m.icon}</span>
                      <div>
                        <div className="font-semibold">{m.symbol}</div>
                        <div className="text-xs text-gray-400">{m.address.slice(0, 6)}…{m.address.slice(-4)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">{fmtUSD(m.price)}</td>
                  <td className="px-6 py-4 text-right">{fmt(m.totalSupplied, 2)} {m.symbol}</td>
                  <td className="px-6 py-4 text-right">{fmt(m.totalBorrowed, 2)} {m.symbol}</td>
                  <td className="px-6 py-4 text-right">{fmtPct(m.utilizationRate)}</td>
                  <td className="px-6 py-4 text-right text-green-600 font-medium">{fmtPct(m.supplyAPY)}</td>
                  <td className="px-6 py-4 text-right text-orange-600 font-medium">{fmtPct(m.borrowAPY)}</td>
                  <td className="px-6 py-4 text-right text-gray-500">
                    {m.ltv?.toString()}% / {m.liqThreshold?.toString()}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Your Positions */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Your Positions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-gray-500 font-medium">Asset</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Wallet Balance</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Supplied (+ interest)</th>
                <th className="px-6 py-3 text-right text-gray-500 font-medium">Borrowed (+ interest)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {markets.map((m) => (
                <tr key={m.address} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <span className="text-xl mr-2">{m.icon}</span>
                    <span className="font-semibold">{m.symbol}</span>
                  </td>
                  <td className="px-6 py-4 text-right">{fmt(walletBals[m.address], 4)} {m.symbol}</td>
                  <td className="px-6 py-4 text-right text-green-700 font-medium">
                    {fmt(m.supplyBal, 4)} {m.symbol}
                  </td>
                  <td className="px-6 py-4 text-right text-orange-700 font-medium">
                    {fmt(m.borrowBal, 4)} {m.symbol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Faucet */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Test Token Faucet</h2>
        <p className="text-sm text-gray-500 mb-4">
          Claim free test tokens to try the protocol (local testnet only).
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => claimFaucet(LENDING_ADDRESSES.Stablecoin, 'C5D')}
            className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-medium"
          >
            💵 Claim 1,000 C5D
          </button>
          <button
            onClick={() => claimFaucet(LENDING_ADDRESSES.MockWETH, 'WETH')}
            className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 text-sm font-medium"
          >
            ⚡ Claim 10 WETH
          </button>
        </div>
        {claimMsg && <p className="mt-3 text-sm">{claimMsg}</p>}
      </div>
    </div>
  );
}
