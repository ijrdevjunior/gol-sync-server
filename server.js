const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Senha do painel do proprietário (pode ser configurada via variável de ambiente)
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'gol2024';

// Middleware - CORS configurado para aceitar requisições de qualquer origem (incluindo Electron)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Owner-Password'],
  credentials: false
}));

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Servir arquivos estáticos do painel
app.use('/dashboard', express.static(path.join(__dirname, 'public')));

// Data storage (in-memory for Vercel serverless)
// Note: In Vercel, data is stored in memory only and will be lost on cold start
// For production, consider using an external database (MongoDB, Supabase, etc.)
const salesStore = new Map();
const stores = new Map();
const productsStore = new Map(); // Store products by storeId
const categoriesStore = new Map(); // Store categories
const promotionsStore = new Map(); // Store promotions

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

// =====================================
// APIs DE ADMINISTRAÇÃO - Produtos, Categorias, Promoções
// =====================================

// Listar todos os produtos
app.get('/api/admin/products', checkOwnerAuth, (req, res) => {
  try {
    const allProducts = [];
    productsStore.forEach((products, storeId) => {
      products.forEach(p => {
        if (!allProducts.find(ap => ap.id === p.id || ap.barcode === p.barcode)) {
          allProducts.push({ ...p, source_store_id: storeId });
        }
      });
    });
    res.json({ products: allProducts, total: allProducts.length });
  } catch (error) {
    console.error('Error listing products:', error);
    res.status(500).json({ error: 'Erro ao listar produtos' });
  }
});

// Buscar produto por ID ou barcode
app.get('/api/admin/products/:id', checkOwnerAuth, (req, res) => {
  try {
    const { id } = req.params;
    let found = null;
    productsStore.forEach((products) => {
      const product = products.find(p => p.id == id || p.barcode === id);
      if (product) found = product;
    });
    if (found) {
      res.json(found);
    } else {
      res.status(404).json({ error: 'Produto não encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

// Criar/Atualizar produto (será sincronizado para todas as lojas)
app.post('/api/admin/products', checkOwnerAuth, (req, res) => {
  try {
    const product = req.body;
    product.updated_at = new Date().toISOString();
    
    if (!product.id) {
      product.id = Date.now();
      product.created_at = new Date().toISOString();
    }

    // Adicionar ao store 1 (loja principal/master)
    if (!productsStore.has(1)) {
      productsStore.set(1, []);
    }
    
    const products = productsStore.get(1);
    const existingIndex = products.findIndex(p => p.id === product.id || (p.barcode && p.barcode === product.barcode));
    
    if (existingIndex >= 0) {
      products[existingIndex] = { ...products[existingIndex], ...product };
    } else {
      products.push(product);
    }
    
    productsStore.set(1, products);
    
    console.log(`✅ Produto ${product.name} salvo com sucesso`);
    res.json({ success: true, product });
  } catch (error) {
    console.error('Error saving product:', error);
    res.status(500).json({ error: 'Erro ao salvar produto' });
  }
});

// Deletar produto
app.delete('/api/admin/products/:id', checkOwnerAuth, (req, res) => {
  try {
    const { id } = req.params;
    let deleted = false;
    
    productsStore.forEach((products, storeId) => {
      const index = products.findIndex(p => p.id == id);
      if (index >= 0) {
        products.splice(index, 1);
        productsStore.set(storeId, products);
        deleted = true;
      }
    });
    
    if (deleted) {
      res.json({ success: true, message: 'Produto deletado' });
    } else {
      res.status(404).json({ error: 'Produto não encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar produto' });
  }
});

// Listar todas as categorias
app.get('/api/admin/categories', checkOwnerAuth, (req, res) => {
  try {
    const allCategories = [];
    categoriesStore.forEach((categories) => {
      categories.forEach(c => {
        if (!allCategories.find(ac => ac.id === c.id)) {
          allCategories.push(c);
        }
      });
    });
    res.json({ categories: allCategories, total: allCategories.length });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar categorias' });
  }
});

// Criar/Atualizar categoria
app.post('/api/admin/categories', checkOwnerAuth, (req, res) => {
  try {
    const category = req.body;
    category.updated_at = new Date().toISOString();
    
    if (!category.id) {
      category.id = Date.now();
      category.created_at = new Date().toISOString();
    }

    if (!categoriesStore.has(1)) {
      categoriesStore.set(1, []);
    }
    
    const categories = categoriesStore.get(1);
    const existingIndex = categories.findIndex(c => c.id === category.id);
    
    if (existingIndex >= 0) {
      categories[existingIndex] = { ...categories[existingIndex], ...category };
    } else {
      categories.push(category);
    }
    
    categoriesStore.set(1, categories);
    res.json({ success: true, category });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar categoria' });
  }
});

// Deletar categoria
app.delete('/api/admin/categories/:id', checkOwnerAuth, (req, res) => {
  try {
    const { id } = req.params;
    let deleted = false;
    
    categoriesStore.forEach((categories, storeId) => {
      const index = categories.findIndex(c => c.id == id);
      if (index >= 0) {
        categories.splice(index, 1);
        categoriesStore.set(storeId, categories);
        deleted = true;
      }
    });
    
    if (deleted) {
      res.json({ success: true, message: 'Categoria deletada' });
    } else {
      res.status(404).json({ error: 'Categoria não encontrada' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar categoria' });
  }
});

// Listar todas as promoções
app.get('/api/admin/promotions', checkOwnerAuth, (req, res) => {
  try {
    const promotions = Array.from(promotionsStore.values()).flat();
    res.json({ promotions, total: promotions.length });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar promoções' });
  }
});

// Criar/Atualizar promoção
app.post('/api/admin/promotions', checkOwnerAuth, (req, res) => {
  try {
    const promotion = req.body;
    promotion.updated_at = new Date().toISOString();
    
    if (!promotion.id) {
      promotion.id = Date.now();
      promotion.created_at = new Date().toISOString();
    }

    if (!promotionsStore.has(1)) {
      promotionsStore.set(1, []);
    }
    
    const promotions = promotionsStore.get(1);
    const existingIndex = promotions.findIndex(p => p.id === promotion.id);
    
    if (existingIndex >= 0) {
      promotions[existingIndex] = { ...promotions[existingIndex], ...promotion };
    } else {
      promotions.push(promotion);
    }
    
    promotionsStore.set(1, promotions);
    console.log(`✅ Promoção salva: ${promotion.name || promotion.product_name}`);
    res.json({ success: true, promotion });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar promoção' });
  }
});

// Deletar promoção
app.delete('/api/admin/promotions/:id', checkOwnerAuth, (req, res) => {
  try {
    const { id } = req.params;
    let deleted = false;
    
    promotionsStore.forEach((promotions, storeId) => {
      const index = promotions.findIndex(p => p.id == id);
      if (index >= 0) {
        promotions.splice(index, 1);
        promotionsStore.set(storeId, promotions);
        deleted = true;
      }
    });
    
    if (deleted) {
      res.json({ success: true, message: 'Promoção deletada' });
    } else {
      res.status(404).json({ error: 'Promoção não encontrada' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar promoção' });
  }
});

// Estatísticas gerais do sistema
app.get('/api/admin/stats', checkOwnerAuth, (req, res) => {
  try {
    let totalProducts = 0;
    productsStore.forEach(products => {
      totalProducts = Math.max(totalProducts, products.length);
    });

    let totalCategories = 0;
    categoriesStore.forEach(categories => {
      totalCategories = Math.max(totalCategories, categories.length);
    });

    const totalPromotions = Array.from(promotionsStore.values()).flat().length;
    const totalStores = stores.size;

    let totalSales = 0;
    let totalRevenue = 0;
    salesStore.forEach(sales => {
      totalSales += sales.length;
      totalRevenue += sales.reduce((sum, s) => sum + (s.total || 0), 0);
    });

    res.json({
      totalProducts,
      totalCategories,
      totalPromotions,
      totalStores,
      totalSales,
      totalRevenue
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao obter estatísticas' });
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
  <title>🏪 Gol Supermarket - Painel Administrativo</title>
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
    .tab-btn { transition: all 0.2s; }
    .tab-btn.active { background: white; color: #1e3a5f; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .table-row:hover { background: #f8fafc; }
    .modal-overlay { background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
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
      <div class="max-w-7xl mx-auto px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <span class="text-3xl">🏪</span>
            <div>
              <h1 class="text-xl font-bold">Gol Supermarket</h1>
              <p class="text-blue-200 text-xs">Painel Administrativo</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 bg-green-500/30 px-2 py-1 rounded-full">
              <span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              <span class="text-xs font-medium text-green-200">TEMPO REAL</span>
            </div>
            <span id="lastUpdate" class="text-xs text-blue-200">--</span>
            <button onclick="refreshCurrentTab()" class="p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors" title="Atualizar">🔄</button>
            <button onclick="logout()" class="p-2 bg-red-500/80 rounded-lg hover:bg-red-600 transition-colors" title="Sair">🚪</button>
          </div>
        </div>
        <!-- Navigation Tabs -->
        <div class="flex gap-2 mt-3">
          <button onclick="switchTab('dashboard')" class="tab-btn active px-4 py-2 rounded-lg text-sm font-medium bg-white/20">📊 Dashboard</button>
          <button onclick="switchTab('products')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">📦 Produtos</button>
          <button onclick="switchTab('categories')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">📁 Categorias</button>
          <button onclick="switchTab('promotions')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">🏷️ Promoções</button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6">
      <!-- DASHBOARD TAB -->
      <div id="tab-dashboard" class="tab-content active">
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

      </div><!-- End Dashboard Tab -->

      <!-- PRODUCTS TAB -->
      <div id="tab-products" class="tab-content">
        <div class="bg-white rounded-xl p-6 card-shadow mb-6">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-gray-800">📦 Gerenciar Produtos</h2>
            <div class="flex gap-2">
              <input type="text" id="productSearch" placeholder="Buscar produto..." 
                class="px-4 py-2 border rounded-lg w-64" oninput="filterProducts()">
              <button onclick="openProductModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                ➕ Novo Produto
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Código</th>
                  <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Nome</th>
                  <th class="px-4 py-3 text-left text-sm font-medium text-gray-600">Categoria</th>
                  <th class="px-4 py-3 text-right text-sm font-medium text-gray-600">Preço</th>
                  <th class="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                  <th class="px-4 py-3 text-center text-sm font-medium text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody id="productsTableBody" class="divide-y divide-gray-100">
                <tr><td colspan="6" class="text-center py-8 text-gray-400">Carregando produtos...</td></tr>
              </tbody>
            </table>
          </div>
          <div id="productsPagination" class="flex justify-center gap-2 mt-4"></div>
        </div>
      </div>

      <!-- CATEGORIES TAB -->
      <div id="tab-categories" class="tab-content">
        <div class="bg-white rounded-xl p-6 card-shadow mb-6">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-gray-800">📁 Gerenciar Categorias</h2>
            <button onclick="openCategoryModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              ➕ Nova Categoria
            </button>
          </div>
          <div id="categoriesGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="text-center py-8 text-gray-400 col-span-full">Carregando categorias...</div>
          </div>
        </div>
      </div>

      <!-- PROMOTIONS TAB -->
      <div id="tab-promotions" class="tab-content">
        <div class="bg-white rounded-xl p-6 card-shadow mb-6">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-gray-800">🏷️ Gerenciar Promoções</h2>
            <button onclick="openPromotionModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              ➕ Nova Promoção
            </button>
          </div>
          <div id="promotionsGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div class="text-center py-8 text-gray-400 col-span-full">Carregando promoções...</div>
          </div>
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
          <div id="modalContent" class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]"></div>
        </div>
      </div>

      <!-- Product Modal -->
      <div id="productModal" class="fixed inset-0 modal-overlay hidden items-center justify-center z-50">
        <div class="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden mx-4">
          <div class="gradient-bg text-white px-6 py-4 flex justify-between items-center">
            <h2 id="productModalTitle" class="text-xl font-bold">Novo Produto</h2>
            <button onclick="closeProductModal()" class="p-2 hover:bg-white/20 rounded-lg">✕</button>
          </div>
          <form id="productForm" class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]" onsubmit="saveProduct(event)">
            <input type="hidden" id="productId">
            <div class="grid grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-1">Nome do Produto *</label>
                <input type="text" id="productName" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Código de Barras</label>
                <input type="text" id="productBarcode" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                <input type="text" id="productSku" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select id="productCategory" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                  <option value="">Selecione...</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Departamento</label>
                <input type="text" id="productDepartment" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Preço de Venda *</label>
                <input type="number" step="0.01" id="productPrice" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Preço de Custo</label>
                <input type="number" step="0.01" id="productCost" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Estoque</label>
                <input type="number" id="productStock" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Unidade</label>
                <select id="productUnit" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                  <option value="unit">Unidade</option>
                  <option value="kg">Kg</option>
                  <option value="g">Gramas</option>
                  <option value="l">Litros</option>
                  <option value="ml">ML</option>
                </select>
              </div>
              <div class="col-span-2 flex items-center gap-4">
                <label class="flex items-center gap-2">
                  <input type="checkbox" id="productActive" checked class="w-5 h-5">
                  <span class="text-sm text-gray-700">Ativo</span>
                </label>
                <label class="flex items-center gap-2">
                  <input type="checkbox" id="productRequiresScale" class="w-5 h-5">
                  <span class="text-sm text-gray-700">Requer Balança</span>
                </label>
              </div>
            </div>
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button type="button" onclick="closeProductModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar Produto</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Category Modal -->
      <div id="categoryModal" class="fixed inset-0 modal-overlay hidden items-center justify-center z-50">
        <div class="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-hidden mx-4">
          <div class="gradient-bg text-white px-6 py-4 flex justify-between items-center">
            <h2 id="categoryModalTitle" class="text-xl font-bold">Nova Categoria</h2>
            <button onclick="closeCategoryModal()" class="p-2 hover:bg-white/20 rounded-lg">✕</button>
          </div>
          <form id="categoryForm" class="p-6" onsubmit="saveCategory(event)">
            <input type="hidden" id="categoryId">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Nome da Categoria *</label>
                <input type="text" id="categoryName" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea id="categoryDescription" rows="3" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"></textarea>
              </div>
            </div>
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button type="button" onclick="closeCategoryModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Promotion Modal -->
      <div id="promotionModal" class="fixed inset-0 modal-overlay hidden items-center justify-center z-50">
        <div class="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden mx-4">
          <div class="gradient-bg text-white px-6 py-4 flex justify-between items-center">
            <h2 id="promotionModalTitle" class="text-xl font-bold">Nova Promoção</h2>
            <button onclick="closePromotionModal()" class="p-2 hover:bg-white/20 rounded-lg">✕</button>
          </div>
          <form id="promotionForm" class="p-6" onsubmit="savePromotion(event)">
            <input type="hidden" id="promotionId">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Nome da Promoção *</label>
                <input type="text" id="promotionName" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Produto (Barcode ou ID)</label>
                <input type="text" id="promotionProduct" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Digite o código de barras ou ID">
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Preço Original</label>
                  <input type="number" step="0.01" id="promotionRegularPrice" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Preço Promocional *</label>
                  <input type="number" step="0.01" id="promotionPrice" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Data Início</label>
                  <input type="date" id="promotionStartDate" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Data Fim</label>
                  <input type="date" id="promotionEndDate" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
              </div>
              <div class="flex items-center gap-2">
                <input type="checkbox" id="promotionActive" checked class="w-5 h-5">
                <label class="text-sm text-gray-700">Promoção Ativa</label>
              </div>
            </div>
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button type="button" onclick="closePromotionModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Salvar</button>
            </div>
          </form>
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
          // Auto refresh every 10 seconds for real-time updates
          setInterval(loadData, 10000);
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

    // =====================
    // TAB NAVIGATION
    // =====================
    let currentTab = 'dashboard';
    let allProducts = [];
    let allCategories = [];
    let allPromotions = [];
    let productPage = 1;
    const productsPerPage = 20;

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(tab)) {
          btn.classList.add('active');
        }
      });
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById('tab-' + tab).classList.add('active');
      
      // Load tab data
      if (tab === 'products') loadProducts();
      else if (tab === 'categories') loadCategories();
      else if (tab === 'promotions') loadPromotions();
      else if (tab === 'dashboard') loadData();
    }

    function refreshCurrentTab() {
      switchTab(currentTab);
    }

    // =====================
    // PRODUCTS MANAGEMENT
    // =====================
    async function loadProducts() {
      try {
        const response = await fetch(API_BASE + '/api/admin/products?password=' + encodeURIComponent(password));
        const data = await response.json();
        allProducts = data.products || [];
        renderProducts();
        await loadCategoriesForSelect();
      } catch (error) {
        console.error('Error loading products:', error);
      }
    }

    function filterProducts() {
      productPage = 1;
      renderProducts();
    }

    function renderProducts() {
      const search = document.getElementById('productSearch').value.toLowerCase();
      const filtered = allProducts.filter(p => 
        (p.name && p.name.toLowerCase().includes(search)) ||
        (p.barcode && p.barcode.includes(search)) ||
        (p.sku && p.sku.includes(search))
      );
      
      const start = (productPage - 1) * productsPerPage;
      const paged = filtered.slice(start, start + productsPerPage);
      const tbody = document.getElementById('productsTableBody');
      
      if (paged.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">Nenhum produto encontrado</td></tr>';
        return;
      }

      tbody.innerHTML = paged.map(p => {
        const category = allCategories.find(c => c.id === p.category_id);
        return '<tr class="table-row hover:bg-gray-50">' +
          '<td class="px-4 py-3"><span class="font-mono text-xs bg-gray-100 px-2 py-1 rounded">' + (p.barcode || p.sku || p.id) + '</span></td>' +
          '<td class="px-4 py-3 font-medium">' + (p.name || 'Sem nome') + '</td>' +
          '<td class="px-4 py-3 text-sm text-gray-600">' + (category ? category.name : '-') + '</td>' +
          '<td class="px-4 py-3 text-right font-bold text-green-600">$' + (p.price || 0).toFixed(2) + '</td>' +
          '<td class="px-4 py-3 text-center">' +
            (p.is_active !== false ? '<span class="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Ativo</span>' : '<span class="px-2 py-1 rounded-full text-xs bg-red-100 text-red-700">Inativo</span>') +
          '</td>' +
          '<td class="px-4 py-3 text-center">' +
            '<button onclick="editProduct(' + p.id + ')" class="text-blue-600 hover:text-blue-800 mr-2">✏️</button>' +
            '<button onclick="deleteProduct(' + p.id + ')" class="text-red-600 hover:text-red-800">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      // Pagination
      const totalPages = Math.ceil(filtered.length / productsPerPage);
      const pagination = document.getElementById('productsPagination');
      pagination.innerHTML = '';
      if (totalPages > 1) {
        for (let i = 1; i <= totalPages; i++) {
          const btn = document.createElement('button');
          btn.className = 'px-3 py-1 rounded ' + (i === productPage ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300');
          btn.textContent = i;
          btn.onclick = () => { productPage = i; renderProducts(); };
          pagination.appendChild(btn);
        }
      }
    }

    async function loadCategoriesForSelect() {
      try {
        const response = await fetch(API_BASE + '/api/admin/categories?password=' + encodeURIComponent(password));
        const data = await response.json();
        allCategories = data.categories || [];
        const select = document.getElementById('productCategory');
        select.innerHTML = '<option value="">Selecione...</option>' +
          allCategories.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    }

    function openProductModal(product = null) {
      document.getElementById('productModalTitle').textContent = product ? 'Editar Produto' : 'Novo Produto';
      document.getElementById('productId').value = product ? product.id : '';
      document.getElementById('productName').value = product ? product.name : '';
      document.getElementById('productBarcode').value = product ? product.barcode || '' : '';
      document.getElementById('productSku').value = product ? product.sku || '' : '';
      document.getElementById('productCategory').value = product ? product.category_id || '' : '';
      document.getElementById('productDepartment').value = product ? product.department || '' : '';
      document.getElementById('productPrice').value = product ? product.price : '';
      document.getElementById('productCost').value = product ? product.cost || '' : '';
      document.getElementById('productStock').value = product ? product.stock || '' : '';
      document.getElementById('productUnit').value = product ? product.unit || 'unit' : 'unit';
      document.getElementById('productActive').checked = product ? product.is_active !== false : true;
      document.getElementById('productRequiresScale').checked = product ? product.requires_scale : false;
      
      document.getElementById('productModal').classList.remove('hidden');
      document.getElementById('productModal').classList.add('flex');
    }

    function closeProductModal() {
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
    }

    function editProduct(id) {
      const product = allProducts.find(p => p.id === id);
      if (product) openProductModal(product);
    }

    async function saveProduct(e) {
      e.preventDefault();
      const product = {
        id: document.getElementById('productId').value ? parseInt(document.getElementById('productId').value) : null,
        name: document.getElementById('productName').value,
        barcode: document.getElementById('productBarcode').value || null,
        sku: document.getElementById('productSku').value || null,
        category_id: document.getElementById('productCategory').value ? parseInt(document.getElementById('productCategory').value) : null,
        department: document.getElementById('productDepartment').value || null,
        price: parseFloat(document.getElementById('productPrice').value) || 0,
        cost: parseFloat(document.getElementById('productCost').value) || 0,
        stock: parseInt(document.getElementById('productStock').value) || 0,
        unit: document.getElementById('productUnit').value,
        is_active: document.getElementById('productActive').checked,
        requires_scale: document.getElementById('productRequiresScale').checked
      };

      try {
        const response = await fetch(API_BASE + '/api/admin/products?password=' + encodeURIComponent(password), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(product)
        });
        
        if (response.ok) {
          closeProductModal();
          loadProducts();
          alert('Produto salvo com sucesso!');
        } else {
          alert('Erro ao salvar produto');
        }
      } catch (error) {
        console.error('Error saving product:', error);
        alert('Erro ao salvar produto');
      }
    }

    async function deleteProduct(id) {
      if (!confirm('Tem certeza que deseja excluir este produto?')) return;
      
      try {
        const response = await fetch(API_BASE + '/api/admin/products/' + id + '?password=' + encodeURIComponent(password), {
          method: 'DELETE'
        });
        
        if (response.ok) {
          loadProducts();
          alert('Produto excluído');
        }
      } catch (error) {
        console.error('Error deleting product:', error);
      }
    }

    // =====================
    // CATEGORIES MANAGEMENT
    // =====================
    async function loadCategories() {
      try {
        const response = await fetch(API_BASE + '/api/admin/categories?password=' + encodeURIComponent(password));
        const data = await response.json();
        allCategories = data.categories || [];
        renderCategories();
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    }

    function renderCategories() {
      const grid = document.getElementById('categoriesGrid');
      if (allCategories.length === 0) {
        grid.innerHTML = '<div class="text-center py-8 text-gray-400 col-span-full">Nenhuma categoria cadastrada</div>';
        return;
      }
      
      grid.innerHTML = allCategories.map(c => 
        '<div class="bg-gray-50 rounded-xl p-4 border-2 border-gray-200 hover:border-blue-400">' +
          '<div class="flex justify-between items-start">' +
            '<div>' +
              '<h4 class="font-bold text-gray-800">📁 ' + c.name + '</h4>' +
              (c.description ? '<p class="text-sm text-gray-500 mt-1">' + c.description + '</p>' : '') +
            '</div>' +
            '<div class="flex gap-1">' +
              '<button onclick="editCategory(' + c.id + ')" class="p-1 hover:bg-gray-200 rounded">✏️</button>' +
              '<button onclick="deleteCategory(' + c.id + ')" class="p-1 hover:bg-red-100 rounded">🗑️</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    function openCategoryModal(category = null) {
      document.getElementById('categoryModalTitle').textContent = category ? 'Editar Categoria' : 'Nova Categoria';
      document.getElementById('categoryId').value = category ? category.id : '';
      document.getElementById('categoryName').value = category ? category.name : '';
      document.getElementById('categoryDescription').value = category ? category.description || '' : '';
      
      document.getElementById('categoryModal').classList.remove('hidden');
      document.getElementById('categoryModal').classList.add('flex');
    }

    function closeCategoryModal() {
      document.getElementById('categoryModal').classList.add('hidden');
      document.getElementById('categoryModal').classList.remove('flex');
    }

    function editCategory(id) {
      const category = allCategories.find(c => c.id === id);
      if (category) openCategoryModal(category);
    }

    async function saveCategory(e) {
      e.preventDefault();
      const category = {
        id: document.getElementById('categoryId').value ? parseInt(document.getElementById('categoryId').value) : null,
        name: document.getElementById('categoryName').value,
        description: document.getElementById('categoryDescription').value || null
      };

      try {
        const response = await fetch(API_BASE + '/api/admin/categories?password=' + encodeURIComponent(password), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(category)
        });
        
        if (response.ok) {
          closeCategoryModal();
          loadCategories();
          alert('Categoria salva!');
        }
      } catch (error) {
        console.error('Error saving category:', error);
      }
    }

    async function deleteCategory(id) {
      if (!confirm('Tem certeza que deseja excluir esta categoria?')) return;
      
      try {
        await fetch(API_BASE + '/api/admin/categories/' + id + '?password=' + encodeURIComponent(password), {
          method: 'DELETE'
        });
        loadCategories();
      } catch (error) {
        console.error('Error deleting category:', error);
      }
    }

    // =====================
    // PROMOTIONS MANAGEMENT
    // =====================
    async function loadPromotions() {
      try {
        const response = await fetch(API_BASE + '/api/admin/promotions?password=' + encodeURIComponent(password));
        const data = await response.json();
        allPromotions = data.promotions || [];
        renderPromotions();
      } catch (error) {
        console.error('Error loading promotions:', error);
      }
    }

    function renderPromotions() {
      const grid = document.getElementById('promotionsGrid');
      if (allPromotions.length === 0) {
        grid.innerHTML = '<div class="text-center py-8 text-gray-400 col-span-full">' +
          '<p class="text-4xl mb-2">🏷️</p>' +
          '<p>Nenhuma promoção cadastrada</p>' +
          '<p class="text-sm">Clique em "Nova Promoção" para criar</p>' +
        '</div>';
        return;
      }
      
      grid.innerHTML = allPromotions.map(p => {
        const isActive = p.is_active !== false;
        const now = new Date();
        const startDate = p.start_date ? new Date(p.start_date) : null;
        const endDate = p.end_date ? new Date(p.end_date) : null;
        const isInPeriod = (!startDate || now >= startDate) && (!endDate || now <= endDate);
        
        return '<div class="bg-gradient-to-br ' + (isActive && isInPeriod ? 'from-green-50 to-green-100 border-green-300' : 'from-gray-50 to-gray-100 border-gray-300') + ' rounded-xl p-4 border-2">' +
          '<div class="flex justify-between items-start mb-3">' +
            '<div>' +
              '<span class="text-2xl">🏷️</span>' +
              '<h4 class="font-bold text-gray-800">' + (p.name || 'Promoção') + '</h4>' +
            '</div>' +
            '<div class="flex gap-1">' +
              '<button onclick="editPromotion(' + p.id + ')" class="p-1 hover:bg-white/50 rounded">✏️</button>' +
              '<button onclick="deletePromotion(' + p.id + ')" class="p-1 hover:bg-red-100 rounded">🗑️</button>' +
            '</div>' +
          '</div>' +
          '<div class="space-y-2">' +
            (p.regular_price ? '<p class="text-sm text-gray-500 line-through">De: $' + p.regular_price.toFixed(2) + '</p>' : '') +
            '<p class="text-2xl font-bold text-green-600">$' + (p.promotional_price || p.price || 0).toFixed(2) + '</p>' +
            (p.start_date || p.end_date ? '<p class="text-xs text-gray-500">' + 
              (p.start_date ? new Date(p.start_date).toLocaleDateString('pt-BR') : '') + 
              ' - ' + 
              (p.end_date ? new Date(p.end_date).toLocaleDateString('pt-BR') : '') + 
            '</p>' : '') +
            '<span class="inline-block px-2 py-1 rounded-full text-xs ' + (isActive && isInPeriod ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-700') + '">' +
              (isActive && isInPeriod ? '✓ Ativa' : 'Inativa') +
            '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function openPromotionModal(promotion = null) {
      document.getElementById('promotionModalTitle').textContent = promotion ? 'Editar Promoção' : 'Nova Promoção';
      document.getElementById('promotionId').value = promotion ? promotion.id : '';
      document.getElementById('promotionName').value = promotion ? promotion.name || '' : '';
      document.getElementById('promotionProduct').value = promotion ? promotion.product_id || promotion.barcode || '' : '';
      document.getElementById('promotionRegularPrice').value = promotion ? promotion.regular_price || '' : '';
      document.getElementById('promotionPrice').value = promotion ? promotion.promotional_price || promotion.price || '' : '';
      document.getElementById('promotionStartDate').value = promotion && promotion.start_date ? promotion.start_date.split('T')[0] : '';
      document.getElementById('promotionEndDate').value = promotion && promotion.end_date ? promotion.end_date.split('T')[0] : '';
      document.getElementById('promotionActive').checked = promotion ? promotion.is_active !== false : true;
      
      document.getElementById('promotionModal').classList.remove('hidden');
      document.getElementById('promotionModal').classList.add('flex');
    }

    function closePromotionModal() {
      document.getElementById('promotionModal').classList.add('hidden');
      document.getElementById('promotionModal').classList.remove('flex');
    }

    function editPromotion(id) {
      const promotion = allPromotions.find(p => p.id === id);
      if (promotion) openPromotionModal(promotion);
    }

    async function savePromotion(e) {
      e.preventDefault();
      const promotion = {
        id: document.getElementById('promotionId').value ? parseInt(document.getElementById('promotionId').value) : null,
        name: document.getElementById('promotionName').value,
        product_id: document.getElementById('promotionProduct').value || null,
        regular_price: parseFloat(document.getElementById('promotionRegularPrice').value) || null,
        promotional_price: parseFloat(document.getElementById('promotionPrice').value) || 0,
        price: parseFloat(document.getElementById('promotionPrice').value) || 0,
        start_date: document.getElementById('promotionStartDate').value || null,
        end_date: document.getElementById('promotionEndDate').value || null,
        is_active: document.getElementById('promotionActive').checked
      };

      try {
        const response = await fetch(API_BASE + '/api/admin/promotions?password=' + encodeURIComponent(password), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(promotion)
        });
        
        if (response.ok) {
          closePromotionModal();
          loadPromotions();
          alert('Promoção salva!');
        }
      } catch (error) {
        console.error('Error saving promotion:', error);
      }
    }

    async function deletePromotion(id) {
      if (!confirm('Tem certeza que deseja excluir esta promoção?')) return;
      
      try {
        await fetch(API_BASE + '/api/admin/promotions/' + id + '?password=' + encodeURIComponent(password), {
          method: 'DELETE'
        });
        loadPromotions();
      } catch (error) {
        console.error('Error deleting promotion:', error);
      }
    }

    // Close modals on outside click
    ['productModal', 'categoryModal', 'promotionModal'].forEach(modalId => {
      document.getElementById(modalId).addEventListener('click', (e) => {
        if (e.target.id === modalId) {
          document.getElementById(modalId).classList.add('hidden');
          document.getElementById(modalId).classList.remove('flex');
        }
      });
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


