const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Senha do painel do proprietário (pode ser configurada via variável de ambiente)
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'gol2024';

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Servir arquivos estáticos do painel
app.use('/dashboard', express.static(path.join(__dirname, 'public')));

// Data storage (in-memory for Vercel serverless)
// Note: In Vercel, data is stored in memory only and will be lost on cold start
// For production, consider using an external database (MongoDB, Supabase, etc.)
const salesStore = new Map();
const stores = new Map();
const productsStore = new Map(); // Store products by storeId
const categoriesStore = new Map(); // Store categories

// Try to load data from files (only works in local/dev environment)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const DATA_DIR = !isVercel ? path.join(__dirname, 'data') : null;
const SALES_FILE = !isVercel ? path.join(DATA_DIR, 'sales.json') : null;
const STORES_FILE = !isVercel ? path.join(DATA_DIR, 'stores.json') : null;

if (!isVercel && DATA_DIR) {
  // Ensure data directory exists (local only)
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load data from files (local only)
  try {
    if (fs.existsSync(SALES_FILE)) {
      const salesData = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
      Object.entries(salesData).forEach(([storeId, sales]) => {
        salesStore.set(parseInt(storeId), sales);
      });
      console.log('✅ Loaded sales data from file');
    }
  } catch (error) {
    console.error('❌ Error loading sales data:', error.message);
  }

  try {
    if (fs.existsSync(STORES_FILE)) {
      const storesData = JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
      Object.entries(storesData).forEach(([storeId, store]) => {
        stores.set(parseInt(storeId), store);
      });
      console.log('✅ Loaded stores data from file');
    }
  } catch (error) {
    console.error('❌ Error loading stores data:', error.message);
  }

  // Auto-save every 30 seconds (local only)
  setInterval(() => {
    try {
      const salesData = {};
      salesStore.forEach((sales, storeId) => {
        salesData[storeId] = sales;
      });
      fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));
      
      const storesData = {};
      stores.forEach((store, storeId) => {
        storesData[storeId] = store;
      });
      fs.writeFileSync(STORES_FILE, JSON.stringify(storesData, null, 2));
    } catch (error) {
      console.error('❌ Error saving data:', error.message);
    }
  }, 30000);

  // Save on exit (local only)
  process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    try {
      const salesData = {};
      salesStore.forEach((sales, storeId) => {
        salesData[storeId] = sales;
      });
      fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));
      
      const storesData = {};
      stores.forEach((store, storeId) => {
        storesData[storeId] = store;
      });
      fs.writeFileSync(STORES_FILE, JSON.stringify(storesData, null, 2));
    } catch (error) {
      console.error('❌ Error saving data:', error.message);
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    try {
      const salesData = {};
      salesStore.forEach((sales, storeId) => {
        salesData[storeId] = sales;
      });
      fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));
      
      const storesData = {};
      stores.forEach((store, storeId) => {
        storesData[storeId] = store;
      });
      fs.writeFileSync(STORES_FILE, JSON.stringify(storesData, null, 2));
    } catch (error) {
      console.error('❌ Error saving data:', error.message);
    }
    process.exit(0);
  });
} else {
  console.log('⚠️  Running in Vercel/serverless mode - data stored in memory only');
}

// Health check endpoint
app.get('/api/sync/health', (req, res) => {
  res.json({ status: 'ok', message: 'Sync server is running' });
});

// Push sales from a store
app.post('/api/sync/push', (req, res) => {
  try {
    const { storeId, sales, timestamp } = req.body;

    if (!storeId || !sales || !Array.isArray(sales)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    // Store sales with timestamp
    const existingSales = salesStore.get(storeId) || [];
    const newSales = sales.filter(sale => {
      // Only add sales that don't already exist
      return !existingSales.some(existing => existing.sale_number === sale.sale_number);
    });

    salesStore.set(storeId, [...existingSales, ...newSales]);
    
    console.log(`✅ Received ${newSales.length} new sales from store ${storeId} (Total: ${salesStore.get(storeId).length})`);

    res.json({
      success: true,
      message: `Received ${newSales.length} sales`,
      totalSales: salesStore.get(storeId).length,
    });
  } catch (error) {
    console.error('Error pushing sales:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pull sales from other stores
app.get('/api/sync/pull', (req, res) => {
  try {
    const { storeId, since } = req.query;
    const allSales = [];

    // Get sales from all stores except the requesting store
    for (const [id, sales] of salesStore.entries()) {
      if (storeId && parseInt(storeId) === id) {
        continue; // Skip own store
      }

      let filteredSales = sales;

      // Filter by timestamp if provided
      if (since) {
        filteredSales = sales.filter(sale => {
          const saleTime = new Date(sale.created_at || sale.timestamp);
          const sinceTime = new Date(since);
          return saleTime > sinceTime;
        });
      }

      allSales.push(...filteredSales);
    }

    // Sort by timestamp (newest first)
    allSales.sort((a, b) => {
      const timeA = new Date(a.created_at || a.timestamp || 0);
      const timeB = new Date(b.created_at || b.timestamp || 0);
      return timeB - timeA;
    });

    console.log(`Sending ${allSales.length} sales to store ${storeId || 'all'}`);

    res.json({
      success: true,
      sales: allSales,
      count: allSales.length,
    });
  } catch (error) {
    console.error('Error pulling sales:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all stores
app.get('/api/sync/stores', (req, res) => {
  const storesList = Array.from(stores.values());
  res.json({ stores: storesList });
});

// Register a store
app.post('/api/sync/stores', (req, res) => {
  try {
    const { id, name, address, phone } = req.body;
    stores.set(id, { id, name, address, phone, registeredAt: new Date().toISOString() });
    console.log(`📝 Store registered: ${name} (ID: ${id})`);
    res.json({ success: true, store: stores.get(id) });
  } catch (error) {
    console.error('❌ Error registering store:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get statistics
app.get('/api/sync/stats', (req, res) => {
  const stats = {
    totalStores: stores.size,
    totalSales: Array.from(salesStore.values()).reduce((sum, sales) => sum + sales.length, 0),
    salesByStore: {},
  };

  for (const [id, sales] of salesStore.entries()) {
    stats.salesByStore[id] = sales.length;
  }

  res.json(stats);
});

// Push products from a store
app.post('/api/sync/products/push', (req, res) => {
  try {
    const { storeId, products, categories, timestamp, isLastBatch } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    // Store products (merge with existing, not replace)
    if (products && Array.isArray(products) && products.length > 0) {
      const existingProducts = productsStore.get(storeId) || [];
      const productMap = new Map();
      
      // Add existing products to map
      existingProducts.forEach(p => {
        productMap.set(p.id || p.barcode || p.sku, p);
      });
      
      // Merge new products (update or add)
      products.forEach(p => {
        const key = p.id || p.barcode || p.sku;
        productMap.set(key, p);
      });
      
      // Convert back to array
      const mergedProducts = Array.from(productMap.values());
      productsStore.set(storeId, mergedProducts);
      console.log(`✅ Received ${products.length} products from store ${storeId} (Total: ${mergedProducts.length})`);
    }

    // Store categories (merge with existing)
    if (categories && Array.isArray(categories) && categories.length > 0) {
      categories.forEach(cat => {
        categoriesStore.set(cat.id, cat);
      });
      console.log(`✅ Received ${categories.length} categories from store ${storeId} (Total: ${categoriesStore.size})`);
    }

    const currentProducts = productsStore.get(storeId) || [];
    res.json({
      success: true,
      message: `Received ${products?.length || 0} products and ${categories?.length || 0} categories`,
      totalProducts: currentProducts.length,
      isLastBatch: isLastBatch || false,
    });
  } catch (error) {
    console.error('Error pushing products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pull products from master store (usually store 1)
app.get('/api/sync/products/pull', (req, res) => {
  try {
    const { storeId } = req.query;
    
    // Get products from master store (ID 1) or specified store
    const masterStoreId = storeId ? parseInt(storeId) : 1;
    const products = productsStore.get(masterStoreId) || [];
    const categories = Array.from(categoriesStore.values());

    console.log(`Sending ${products.length} products and ${categories.length} categories to store ${storeId || 'all'}`);

    res.json({
      success: true,
      products: products,
      categories: categories,
      count: products.length,
    });
  } catch (error) {
    console.error('Error pulling products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================
// PAINEL DO PROPRIETÁRIO - Relatórios Centralizados
// =====================================

// Middleware de autenticação simples
const checkOwnerAuth = (req, res, next) => {
  const password = req.headers['x-owner-password'] || req.query.password;
  if (password !== OWNER_PASSWORD) {
    return res.status(401).json({ error: 'Senha inválida' });
  }
  next();
};

// Relatório consolidado de todas as lojas
app.get('/api/owner/report', checkOwnerAuth, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate + 'T23:59:59') : new Date();

    const report = {
      generatedAt: new Date().toISOString(),
      period: { start: start.toISOString(), end: end.toISOString() },
      stores: [],
      totals: {
        totalRevenue: 0,
        totalTransactions: 0,
        avgTicket: 0,
      }
    };

    // Processar cada loja
    for (const [storeId, sales] of salesStore.entries()) {
      const store = stores.get(storeId) || { id: storeId, name: `Loja ${storeId}` };
      
      // Filtrar vendas por data
      const filteredSales = sales.filter(sale => {
        const saleDate = new Date(sale.created_at || sale.timestamp);
        return saleDate >= start && saleDate <= end;
      });

      const storeRevenue = filteredSales.reduce((sum, sale) => sum + (sale.total || 0), 0);
      const storeTransactions = filteredSales.length;
      const storeAvgTicket = storeTransactions > 0 ? storeRevenue / storeTransactions : 0;

      // Vendas por dia
      const salesByDay = {};
      filteredSales.forEach(sale => {
        const day = new Date(sale.created_at || sale.timestamp).toISOString().split('T')[0];
        if (!salesByDay[day]) {
          salesByDay[day] = { revenue: 0, transactions: 0 };
        }
        salesByDay[day].revenue += sale.total || 0;
        salesByDay[day].transactions += 1;
      });

      report.stores.push({
        id: storeId,
        name: store.name,
        address: store.address,
        phone: store.phone,
        revenue: storeRevenue,
        transactions: storeTransactions,
        avgTicket: storeAvgTicket,
        salesByDay: salesByDay,
        lastSale: filteredSales.length > 0 ? 
          filteredSales.sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))[0] : null
      });

      report.totals.totalRevenue += storeRevenue;
      report.totals.totalTransactions += storeTransactions;
    }

    report.totals.avgTicket = report.totals.totalTransactions > 0 ? 
      report.totals.totalRevenue / report.totals.totalTransactions : 0;

    // Ordenar lojas por receita (maior primeiro)
    report.stores.sort((a, b) => b.revenue - a.revenue);

    res.json(report);
  } catch (error) {
    console.error('Error generating owner report:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// Lista de todas as lojas com status
app.get('/api/owner/stores', checkOwnerAuth, (req, res) => {
  try {
    const storesList = [];
    
    for (const [storeId, store] of stores.entries()) {
      const sales = salesStore.get(storeId) || [];
      const lastSale = sales.length > 0 ? 
        sales.sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))[0] : null;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todaySales = sales.filter(sale => new Date(sale.created_at || sale.timestamp) >= today);
      const todayRevenue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);

      storesList.push({
        ...store,
        totalSales: sales.length,
        todaySales: todaySales.length,
        todayRevenue: todayRevenue,
        lastSaleAt: lastSale ? (lastSale.created_at || lastSale.timestamp) : null,
        isActive: lastSale ? (new Date() - new Date(lastSale.created_at || lastSale.timestamp)) < 24 * 60 * 60 * 1000 : false
      });
    }

    // Adicionar lojas que têm vendas mas não estão registradas
    for (const [storeId, sales] of salesStore.entries()) {
      if (!stores.has(storeId)) {
        const lastSale = sales.length > 0 ? 
          sales.sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))[0] : null;
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todaySales = sales.filter(sale => new Date(sale.created_at || sale.timestamp) >= today);
        const todayRevenue = todaySales.reduce((sum, sale) => sum + (sale.total || 0), 0);

        storesList.push({
          id: storeId,
          name: `Loja ${storeId}`,
          totalSales: sales.length,
          todaySales: todaySales.length,
          todayRevenue: todayRevenue,
          lastSaleAt: lastSale ? (lastSale.created_at || lastSale.timestamp) : null,
          isActive: lastSale ? (new Date() - new Date(lastSale.created_at || lastSale.timestamp)) < 24 * 60 * 60 * 1000 : false
        });
      }
    }

    res.json({ stores: storesList });
  } catch (error) {
    console.error('Error getting stores for owner:', error);
    res.status(500).json({ error: 'Erro ao obter lojas' });
  }
});

// Vendas detalhadas de uma loja específica
app.get('/api/owner/store/:storeId/sales', checkOwnerAuth, (req, res) => {
  try {
    const storeId = parseInt(req.params.storeId);
    const { startDate, endDate, limit = 100 } = req.query;
    
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate + 'T23:59:59') : new Date();
    
    const sales = salesStore.get(storeId) || [];
    
    const filteredSales = sales
      .filter(sale => {
        const saleDate = new Date(sale.created_at || sale.timestamp);
        return saleDate >= start && saleDate <= end;
      })
      .sort((a, b) => new Date(b.created_at || b.timestamp) - new Date(a.created_at || a.timestamp))
      .slice(0, parseInt(limit));

    const totalRevenue = filteredSales.reduce((sum, sale) => sum + (sale.total || 0), 0);

    res.json({
      storeId,
      store: stores.get(storeId) || { id: storeId, name: `Loja ${storeId}` },
      sales: filteredSales,
      count: filteredSales.length,
      totalRevenue: totalRevenue
    });
  } catch (error) {
    console.error('Error getting store sales:', error);
    res.status(500).json({ error: 'Erro ao obter vendas da loja' });
  }
});

// Comparativo entre lojas
app.get('/api/owner/compare', checkOwnerAuth, (req, res) => {
  try {
    const { period = '7' } = req.query; // dias
    const days = parseInt(period);
    
    const comparison = [];
    const now = new Date();

    for (const [storeId, sales] of salesStore.entries()) {
      const store = stores.get(storeId) || { id: storeId, name: `Loja ${storeId}` };
      
      const dailyData = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        
        const daySales = sales.filter(sale => {
          const saleDate = new Date(sale.created_at || sale.timestamp);
          return saleDate >= date && saleDate < nextDate;
        });
        
        dailyData.push({
          date: date.toISOString().split('T')[0],
          revenue: daySales.reduce((sum, sale) => sum + (sale.total || 0), 0),
          transactions: daySales.length
        });
      }

      comparison.push({
        storeId,
        storeName: store.name,
        dailyData: dailyData,
        totalRevenue: dailyData.reduce((sum, d) => sum + d.revenue, 0),
        totalTransactions: dailyData.reduce((sum, d) => sum + d.transactions, 0)
      });
    }

    // Ordenar por receita total
    comparison.sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({ period: days, comparison });
  } catch (error) {
    console.error('Error comparing stores:', error);
    res.status(500).json({ error: 'Erro ao comparar lojas' });
  }
});

// Página principal do painel do proprietário (HTML embutido)
app.get('/owner', (req, res) => {
  res.send(getOwnerDashboardHTML());
});

// Função que retorna o HTML do painel do proprietário
function getOwnerDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🏪 Gol Supermarket - Painel do Proprietário</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%); }
    .card-shadow { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
    .glow { box-shadow: 0 0 20px rgba(59, 130, 246, 0.3); }
    .store-card:hover { transform: translateY(-2px); transition: all 0.2s; }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <!-- Login Screen -->
  <div id="loginScreen" class="min-h-screen gradient-bg flex items-center justify-center">
    <div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
      <div class="text-center mb-8">
        <div class="text-6xl mb-4">🏪</div>
        <h1 class="text-2xl font-bold text-gray-800">Gol Supermarket</h1>
        <p class="text-gray-500">Painel do Proprietário</p>
      </div>
      <form id="loginForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Senha de Acesso</label>
          <input type="password" id="passwordInput" placeholder="Digite a senha" 
            class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg">
        </div>
        <button type="submit" 
          class="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors text-lg">
          Entrar
        </button>
        <p id="loginError" class="text-red-500 text-center hidden">Senha incorreta</p>
      </form>
    </div>
  </div>

  <!-- Dashboard Screen -->
  <div id="dashboardScreen" class="hidden">
    <!-- Header -->
    <header class="gradient-bg text-white shadow-lg">
      <div class="max-w-7xl mx-auto px-4 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <span class="text-4xl">🏪</span>
            <div>
              <h1 class="text-2xl font-bold">Gol Supermarket</h1>
              <p class="text-blue-200 text-sm">Painel Central - Todas as Lojas</p>
            </div>
          </div>
          <div class="flex items-center gap-4">
            <div class="text-right">
              <p class="text-sm text-blue-200">Última atualização</p>
              <p id="lastUpdate" class="font-semibold">--</p>
            </div>
            <button onclick="loadData()" class="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors" title="Atualizar">
              🔄
            </button>
            <button onclick="logout()" class="p-2 bg-red-500/80 rounded-lg hover:bg-red-600 transition-colors" title="Sair">
              🚪
            </button>
          </div>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <!-- Period Filter -->
      <div class="bg-white rounded-xl p-4 mb-6 card-shadow flex flex-wrap items-center gap-4">
        <span class="font-medium text-gray-700">📅 Período:</span>
        <button onclick="setPeriod('today')" class="period-btn px-4 py-2 rounded-lg bg-gray-100 hover:bg-blue-100 transition-colors" data-period="today">Hoje</button>
        <button onclick="setPeriod('week')" class="period-btn px-4 py-2 rounded-lg bg-blue-600 text-white" data-period="week">7 Dias</button>
        <button onclick="setPeriod('month')" class="period-btn px-4 py-2 rounded-lg bg-gray-100 hover:bg-blue-100 transition-colors" data-period="month">30 Dias</button>
        <div class="flex items-center gap-2 ml-auto">
          <input type="date" id="startDate" class="px-3 py-2 border rounded-lg">
          <span>até</span>
          <input type="date" id="endDate" class="px-3 py-2 border rounded-lg">
          <button onclick="applyCustomPeriod()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">Filtrar</button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl p-6 card-shadow">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-green-100 text-sm font-medium">💰 Receita Total</p>
              <p id="totalRevenue" class="text-3xl font-bold mt-2">$0.00</p>
            </div>
            <div class="text-5xl opacity-30">$</div>
          </div>
        </div>

        <div class="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-6 card-shadow">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-blue-100 text-sm font-medium">📊 Total Vendas</p>
              <p id="totalTransactions" class="text-3xl font-bold mt-2">0</p>
            </div>
            <div class="text-5xl opacity-30">📋</div>
          </div>
        </div>

        <div class="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-6 card-shadow">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-purple-100 text-sm font-medium">🎫 Ticket Médio</p>
              <p id="avgTicket" class="text-3xl font-bold mt-2">$0.00</p>
            </div>
            <div class="text-5xl opacity-30">🧾</div>
          </div>
        </div>

        <div class="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-xl p-6 card-shadow">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-orange-100 text-sm font-medium">🏪 Lojas Ativas</p>
              <p id="activeStores" class="text-3xl font-bold mt-2">0</p>
            </div>
            <div class="text-5xl opacity-30">🏬</div>
          </div>
        </div>
      </div>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <!-- Revenue Chart -->
        <div class="bg-white rounded-xl p-6 card-shadow">
          <h3 class="text-lg font-bold text-gray-800 mb-4">📈 Receita por Dia</h3>
          <canvas id="revenueChart" height="200"></canvas>
        </div>

        <!-- Store Comparison -->
        <div class="bg-white rounded-xl p-6 card-shadow">
          <h3 class="text-lg font-bold text-gray-800 mb-4">🏆 Comparativo de Lojas</h3>
          <canvas id="storeComparisonChart" height="200"></canvas>
        </div>
      </div>

      <!-- Stores Grid -->
      <div class="bg-white rounded-xl p-6 card-shadow">
        <h3 class="text-xl font-bold text-gray-800 mb-4">🏪 Desempenho por Loja</h3>
        <div id="storesGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <!-- Store cards will be inserted here -->
        </div>
      </div>

      <!-- Store Detail Modal -->
      <div id="storeModal" class="fixed inset-0 bg-black/50 hidden items-center justify-center z-50">
        <div class="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden mx-4">
          <div class="gradient-bg text-white px-6 py-4 flex justify-between items-center">
            <div>
              <h2 id="modalStoreName" class="text-xl font-bold">Loja</h2>
              <p id="modalStoreAddress" class="text-blue-200 text-sm"></p>
            </div>
            <button onclick="closeStoreModal()" class="p-2 hover:bg-white/20 rounded-lg">✕</button>
          </div>
          <div id="modalContent" class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
            <!-- Modal content will be inserted here -->
          </div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-gray-800 text-white text-center py-4 mt-8">
      <p class="text-gray-400">POSGOL - Sistema de Gestão de Vendas © 2024</p>
    </footer>
  </div>

  <script>
    let password = '';
    let currentPeriod = 'week';
    let revenueChart = null;
    let storeComparisonChart = null;
    const API_BASE = window.location.origin;

    // Login
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      password = document.getElementById('passwordInput').value;
      
      try {
        const response = await fetch(API_BASE + '/api/owner/stores?password=' + encodeURIComponent(password));
        if (response.ok) {
          document.getElementById('loginScreen').classList.add('hidden');
          document.getElementById('dashboardScreen').classList.remove('hidden');
          loadData();
          // Auto refresh every 30 seconds
          setInterval(loadData, 30000);
        } else {
          document.getElementById('loginError').classList.remove('hidden');
        }
      } catch (error) {
        console.error('Login error:', error);
        document.getElementById('loginError').classList.remove('hidden');
      }
    });

    function logout() {
      password = '';
      document.getElementById('dashboardScreen').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('passwordInput').value = '';
    }

    function setPeriod(period) {
      currentPeriod = period;
      document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-gray-100');
      });
      document.querySelector('[data-period="' + period + '"]').classList.remove('bg-gray-100');
      document.querySelector('[data-period="' + period + '"]').classList.add('bg-blue-600', 'text-white');
      loadData();
    }

    function getDateRange() {
      const now = new Date();
      let start = new Date();
      let end = new Date();

      switch(currentPeriod) {
        case 'today':
          start.setHours(0, 0, 0, 0);
          break;
        case 'week':
          start.setDate(start.getDate() - 7);
          break;
        case 'month':
          start.setDate(start.getDate() - 30);
          break;
        case 'custom':
          start = new Date(document.getElementById('startDate').value);
          end = new Date(document.getElementById('endDate').value);
          break;
      }

      return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0]
      };
    }

    function applyCustomPeriod() {
      currentPeriod = 'custom';
      document.querySelectorAll('.period-btn').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-gray-100');
      });
      loadData();
    }

    async function loadData() {
      try {
        const { startDate, endDate } = getDateRange();
        
        // Load report
        const reportResponse = await fetch(
          API_BASE + '/api/owner/report?password=' + encodeURIComponent(password) + 
          '&startDate=' + startDate + '&endDate=' + endDate
        );
        const report = await reportResponse.json();

        // Update KPIs
        document.getElementById('totalRevenue').textContent = '$' + report.totals.totalRevenue.toFixed(2);
        document.getElementById('totalTransactions').textContent = report.totals.totalTransactions;
        document.getElementById('avgTicket').textContent = '$' + report.totals.avgTicket.toFixed(2);
        document.getElementById('activeStores').textContent = report.stores.filter(s => s.transactions > 0).length;
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('pt-BR');

        // Update stores grid
        updateStoresGrid(report.stores);

        // Load comparison for charts
        const days = currentPeriod === 'today' ? 1 : currentPeriod === 'week' ? 7 : 30;
        const compareResponse = await fetch(
          API_BASE + '/api/owner/compare?password=' + encodeURIComponent(password) + '&period=' + days
        );
        const comparison = await compareResponse.json();

        // Update charts
        updateCharts(comparison);

      } catch (error) {
        console.error('Error loading data:', error);
      }
    }

    function updateStoresGrid(stores) {
      const grid = document.getElementById('storesGrid');
      
      if (stores.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400"><p class="text-4xl mb-4">🏪</p><p>Nenhuma loja com dados ainda</p></div>';
        return;
      }

      grid.innerHTML = stores.map((store, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
        const hasRecentSale = store.lastSale && (new Date() - new Date(store.lastSale.created_at || store.lastSale.timestamp)) < 3600000;
        
        return '<div class="store-card bg-gray-50 rounded-xl p-4 border-2 border-gray-200 hover:border-blue-400 cursor-pointer" onclick="openStoreModal(' + store.id + ')">' +
          '<div class="flex items-start justify-between mb-3">' +
            '<div class="flex items-center gap-2">' +
              '<span class="text-2xl">' + medal + (medal ? '' : '🏪') + '</span>' +
              '<div>' +
                '<h4 class="font-bold text-gray-800">' + store.name + '</h4>' +
                (store.address ? '<p class="text-xs text-gray-500">' + store.address + '</p>' : '') +
              '</div>' +
            '</div>' +
            (hasRecentSale ? '<span class="pulse text-green-500" title="Venda recente">●</span>' : '') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div class="bg-white rounded-lg p-3 text-center">' +
              '<p class="text-2xl font-bold text-green-600">$' + store.revenue.toFixed(2) + '</p>' +
              '<p class="text-xs text-gray-500">Receita</p>' +
            '</div>' +
            '<div class="bg-white rounded-lg p-3 text-center">' +
              '<p class="text-2xl font-bold text-blue-600">' + store.transactions + '</p>' +
              '<p class="text-xs text-gray-500">Vendas</p>' +
            '</div>' +
          '</div>' +
          '<div class="mt-3 text-xs text-gray-500 flex justify-between">' +
            '<span>Ticket Médio: $' + store.avgTicket.toFixed(2) + '</span>' +
            '<span>Ver detalhes →</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function updateCharts(comparison) {
      // Revenue Chart
      const allDates = [...new Set(comparison.comparison.flatMap(s => s.dailyData.map(d => d.date)))].sort();
      
      const revenueCtx = document.getElementById('revenueChart').getContext('2d');
      
      if (revenueChart) revenueChart.destroy();
      
      const datasets = comparison.comparison.map((store, index) => {
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        return {
          label: store.storeName,
          data: allDates.map(date => {
            const dayData = store.dailyData.find(d => d.date === date);
            return dayData ? dayData.revenue : 0;
          }),
          borderColor: colors[index % colors.length],
          backgroundColor: colors[index % colors.length] + '20',
          fill: true,
          tension: 0.4
        };
      });

      revenueChart = new Chart(revenueCtx, {
        type: 'line',
        data: {
          labels: allDates.map(d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })),
          datasets: datasets
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' }
          },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });

      // Store Comparison Bar Chart
      const storeCtx = document.getElementById('storeComparisonChart').getContext('2d');
      
      if (storeComparisonChart) storeComparisonChart.destroy();
      
      storeComparisonChart = new Chart(storeCtx, {
        type: 'bar',
        data: {
          labels: comparison.comparison.map(s => s.storeName),
          datasets: [{
            label: 'Receita Total',
            data: comparison.comparison.map(s => s.totalRevenue),
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
    }

    async function openStoreModal(storeId) {
      const modal = document.getElementById('storeModal');
      const content = document.getElementById('modalContent');
      
      try {
        const { startDate, endDate } = getDateRange();
        const response = await fetch(
          API_BASE + '/api/owner/store/' + storeId + '/sales?password=' + encodeURIComponent(password) +
          '&startDate=' + startDate + '&endDate=' + endDate + '&limit=50'
        );
        const data = await response.json();

        document.getElementById('modalStoreName').textContent = data.store.name;
        document.getElementById('modalStoreAddress').textContent = data.store.address || '';

        content.innerHTML = 
          '<div class="grid grid-cols-3 gap-4 mb-6">' +
            '<div class="bg-green-50 rounded-xl p-4 text-center">' +
              '<p class="text-3xl font-bold text-green-600">$' + data.totalRevenue.toFixed(2) + '</p>' +
              '<p class="text-sm text-gray-500">Receita Total</p>' +
            '</div>' +
            '<div class="bg-blue-50 rounded-xl p-4 text-center">' +
              '<p class="text-3xl font-bold text-blue-600">' + data.count + '</p>' +
              '<p class="text-sm text-gray-500">Vendas</p>' +
            '</div>' +
            '<div class="bg-purple-50 rounded-xl p-4 text-center">' +
              '<p class="text-3xl font-bold text-purple-600">$' + (data.count > 0 ? (data.totalRevenue / data.count).toFixed(2) : '0.00') + '</p>' +
              '<p class="text-sm text-gray-500">Ticket Médio</p>' +
            '</div>' +
          '</div>' +
          '<h4 class="font-bold text-gray-800 mb-3">📋 Últimas Vendas</h4>' +
          '<div class="overflow-x-auto">' +
            '<table class="w-full">' +
              '<thead class="bg-gray-50">' +
                '<tr>' +
                  '<th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Número</th>' +
                  '<th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Data/Hora</th>' +
                  '<th class="px-4 py-3 text-right text-sm font-medium text-gray-600">Total</th>' +
                  '<th class="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody class="divide-y divide-gray-100">' +
                data.sales.map(sale => 
                  '<tr class="hover:bg-gray-50">' +
                    '<td class="px-4 py-3"><span class="font-mono text-sm bg-gray-100 px-2 py-1 rounded">' + (sale.sale_number || 'N/A') + '</span></td>' +
                    '<td class="px-4 py-3 text-sm text-gray-600">' + new Date(sale.created_at || sale.timestamp).toLocaleString('pt-BR') + '</td>' +
                    '<td class="px-4 py-3 text-right font-bold text-green-600">$' + (sale.total || 0).toFixed(2) + '</td>' +
                    '<td class="px-4 py-3 text-center"><span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">' + (sale.status || 'completed') + '</span></td>' +
                  '</tr>'
                ).join('') +
              '</tbody>' +
            '</table>' +
          '</div>';

        modal.classList.remove('hidden');
        modal.classList.add('flex');
      } catch (error) {
        console.error('Error loading store details:', error);
      }
    }

    function closeStoreModal() {
      const modal = document.getElementById('storeModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    // Close modal on outside click
    document.getElementById('storeModal').addEventListener('click', (e) => {
      if (e.target.id === 'storeModal') closeStoreModal();
    });
  </script>
</body>
</html>`;
}

// Export for Vercel (serverless)
module.exports = app;

// Start server (only if not in Vercel)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀  POSGOL Sync Server - Servidor Central');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📡 Porta: ${PORT}`);
    console.log(`🌐 URL Local: http://localhost:${PORT}`);
    console.log(`🌐 URL Rede: http://[SEU_IP]:${PORT}`);
    console.log('');
    console.log('📋 Endpoints disponíveis:');
    console.log(`   GET  http://localhost:${PORT}/api/sync/health`);
    console.log(`   POST http://localhost:${PORT}/api/sync/push`);
    console.log(`   GET  http://localhost:${PORT}/api/sync/pull`);
    console.log(`   GET  http://localhost:${PORT}/api/sync/stores`);
    console.log(`   GET  http://localhost:${PORT}/api/sync/stats`);
    console.log('');
    if (isVercel) {
      console.log('💾 Persistência de dados: MEMÓRIA (Vercel serverless)');
    } else {
      console.log('💾 Persistência de dados: ATIVADA');
      console.log(`📁 Diretório de dados: ${DATA_DIR}`);
    }
    console.log('');
    console.log('✅ Servidor pronto para receber conexões!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
  });
}

