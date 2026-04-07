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
  if (!val && val !== 0n) return '—';
  const n = Number(ethers.formatEther(val));
  return n.toFixed(d);
}

function fmtPct(val) {
  if (!val) return '0.00%';
  return (Number(ethers.formatEther(val)) * 100).toFixed(2) + '%';
}

export default function LendingPage() {
  const { signer, account, isConnected } = useWeb3Context();

  const [tab, setTab]           = useState('deposit');  // 'deposit' | 'withdraw'
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [amount, setAmount]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [msg, setMsg]           = useState({ text: '', type: '' });
  const [tokenData, setTokenData] = useState({});

  const loadTokenData = useCallback(async () => {
    if (!isConnected || !account) return;
    const pool = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, readProvider);
    const data = {};
    for (const t of TOKENS) {
      const erc = new ethers.Contract(t.address, ERC20_ABI, readProvider);
      const [walletBal, supplyBal, supplyAPY, borrowAPY, utilizationRate] = await Promise.all([
        erc.balanceOf(account),
        pool.getSupplyBalance(account, t.address),
        pool.getSupplyAPY(t.address),
        pool.getBorrowAPY(t.address),
        pool.getUtilizationRate(t.address),
      ]);
      data[t.address] = { walletBal, supplyBal, supplyAPY, borrowAPY, utilizationRate };
    }
    setTokenData(data);
  }, [account, isConnected]);

  useEffect(() => { loadTokenData(); }, [loadTokenData]);

  const setMax = () => {
    const d = tokenData[selectedToken.address];
    if (!d) return;
    const source = tab === 'deposit' ? d.walletBal : d.supplyBal;
    setAmount(ethers.formatEther(source));
  };

  const handleAction = async () => {
    if (!amount || Number(amount) <= 0) {
      setMsg({ text: '❌ Please enter a valid amount', type: 'error' });
      return;
    }

    setLoading(true);
    setMsg({ text: '', type: '' });

    try {
      const pool    = new ethers.Contract(LENDING_ADDRESSES.LendingPool, LENDING_POOL_ABI, signer);
      const erc     = new ethers.Contract(selectedToken.address, ERC20_ABI, signer);
      const ercRead = new ethers.Contract(selectedToken.address, ERC20_ABI, readProvider);
      const amountWei = ethers.parseEther(amount);

      if (tab === 'deposit') {
        // First approve the LendingPool to spend tokens
        setMsg({ text: '⏳ Step 1/2: Approving token transfer…', type: 'info' });
        const allowance = await ercRead.allowance(account, LENDING_ADDRESSES.LendingPool);
        if (allowance < amountWei) {
          const approveTx = await erc.approve(LENDING_ADDRESSES.LendingPool, amountWei);
          await approveTx.wait();
        }

        setMsg({ text: '⏳ Step 2/2: Depositing…', type: 'info' });
        const tx = await pool.deposit(selectedToken.address, amountWei);
        await tx.wait();
        setMsg({ text: `✅ Successfully deposited ${amount} ${selectedToken.symbol}!`, type: 'success' });

      } else {
        setMsg({ text: '⏳ Withdrawing…', type: 'info' });
        const tx = await pool.withdraw(selectedToken.address, amountWei);
        await tx.wait();
        setMsg({ text: `✅ Successfully withdrew ${amount} ${selectedToken.symbol}!`, type: 'success' });
      }

      setAmount('');
      loadTokenData();
    } catch (e) {
      console.error(e);
      setMsg({ text: '❌ ' + (e.reason || e.message?.slice(0, 100)), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-20 text-gray-500">
        Please connect your wallet to use the lending protocol.
      </div>
    );
  }

  const d = tokenData[selectedToken.address];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Supply</h1>
        <p className="text-gray-500 text-sm mt-1">
          Deposit tokens to earn interest. Supplied tokens also serve as collateral for borrowing.
        </p>
      </div>

      {/* Market Overview Cards */}
      <div className="grid grid-cols-2 gap-4">
        {TOKENS.map((t) => {
          const td = tokenData[t.address];
          return (
            <button
              key={t.address}
              onClick={() => setSelectedToken(t)}
              className={`text-left p-4 rounded-xl border-2 transition-all ${
                selectedToken.address === t.address
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{t.icon}</span>
                <span className="font-bold text-lg">{t.symbol}</span>
              </div>
              <div className="text-sm text-gray-600">
                Supply APY: <span className="text-green-600 font-semibold">{fmtPct(td?.supplyAPY)}</span>
              </div>
              <div className="text-sm text-gray-600">
                Your supply: <span className="font-medium">{fmt(td?.supplyBal, 4)} {t.symbol}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                Utilization: {fmtPct(td?.utilizationRate)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Action Panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Tabs */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          {['deposit', 'withdraw'].map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(''); setMsg({ text: '', type: '' }); }}
              className={`flex-1 py-2.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'deposit' ? '⬇ Deposit' : '⬆ Withdraw'}
            </button>
          ))}
        </div>

        {/* Token selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Asset</label>
          <div className="flex gap-2">
            {TOKENS.map((t) => (
              <button
                key={t.address}
                onClick={() => setSelectedToken(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  selectedToken.address === t.address
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
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
            <span>Currently supplied</span>
            <span className="font-medium text-green-700">{fmt(d?.supplyBal)} {selectedToken.symbol}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Supply APY</span>
            <span className="font-medium text-green-600">{fmtPct(d?.supplyAPY)}</span>
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
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={setMax}
              className="px-3 py-3 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-medium"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Info box */}
        {tab === 'deposit' && (
          <div className="text-xs text-gray-500 bg-blue-50 rounded-lg p-3">
            Depositing will earn you <strong>{fmtPct(d?.supplyAPY)}</strong> APY.
            Your deposit also acts as collateral — you can borrow up to{' '}
            <strong>{selectedToken.symbol === 'WETH' ? '75%' : '80%'} (LTV)</strong>
            {' '}of its value.
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleAction}
          disabled={loading || !amount}
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading
            ? 'Processing…'
            : tab === 'deposit'
              ? `Deposit ${amount || '0'} ${selectedToken.symbol}`
              : `Withdraw ${amount || '0'} ${selectedToken.symbol}`}
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

      {/* Interest Rate Model Explanation */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-2">Interest Rate Model</h3>
        <p className="text-sm text-gray-600">
          Interest rates adjust dynamically based on <strong>Utilization Rate</strong> (U = Total Borrowed / Total Supplied).
        </p>
        <div className="mt-3 text-sm text-gray-500 space-y-1">
          <div>Borrow APR = Base Rate + Slope × U</div>
          <div>Supply APR = Borrow APR × U × (1 − 10% reserve)</div>
          <div className="text-xs mt-2">
            {selectedToken.symbol}: Base 2% + Slope {selectedToken.symbol === 'WETH' ? '20' : '10'}% —
            current utilization {fmtPct(d?.utilizationRate)}
          </div>
        </div>
      </div>
    </div>
  );
}
