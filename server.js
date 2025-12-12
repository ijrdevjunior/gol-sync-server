const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Senha do painel do proprietário (pode ser configurada via variável de ambiente)
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'gol2024';

// =====================================
// SUPABASE - BANCO DE DADOS NA NUVEM
// =====================================
// Configure as variáveis de ambiente no Vercel:
// SUPABASE_URL = sua URL do Supabase
// SUPABASE_KEY = sua chave anon/service do Supabase

let supabase = null;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const useSupabase = SUPABASE_URL && SUPABASE_KEY;

if (useSupabase) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase conectado! Dados serão persistidos na nuvem.');
  } catch (error) {
    console.error('❌ Erro ao conectar Supabase:', error.message);
  }
} else {
  console.log('⚠️ Supabase não configurado. Usando armazenamento em memória (dados serão perdidos ao reiniciar).');
}

// =====================================
// FUNÇÕES DO BANCO DE DADOS
// =====================================

// Cache em memória (usado como fallback e para performance)
const salesStore = new Map();
const stores = new Map();
const productsStore = new Map();
const categoriesStore = new Map();
const promotionsStore = new Map();

// Funções para salvar/carregar do Supabase
const db = {
  // PRODUTOS
  async getProducts() {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        return data || [];
      } catch (e) {
        console.error('DB Error getProducts:', e.message);
      }
    }
    // Fallback para memória
    const all = [];
    productsStore.forEach(products => all.push(...products));
    return all;
  },

  async saveProduct(product) {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase
          .from('products')
          .upsert(product, { onConflict: 'id' })
          .select();
        if (error) throw error;
        return data?.[0];
      } catch (e) {
        console.error('DB Error saveProduct:', e.message);
      }
    }
    // Fallback para memória
    if (!productsStore.has(1)) productsStore.set(1, []);
    const products = productsStore.get(1);
    const idx = products.findIndex(p => p.id === product.id);
    if (idx >= 0) products[idx] = product;
    else products.push(product);
    return product;
  },

  async deleteProduct(id) {
    if (useSupabase && supabase) {
      try {
        await supabase.from('products').delete().eq('id', id);
      } catch (e) {
        console.error('DB Error deleteProduct:', e.message);
      }
    }
    // Fallback
    productsStore.forEach((products, storeId) => {
      const idx = products.findIndex(p => p.id == id);
      if (idx >= 0) products.splice(idx, 1);
    });
  },

  // CATEGORIAS
  async getCategories() {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase.from('categories').select('*');
        if (error) throw error;
        return data || [];
      } catch (e) {
        console.error('DB Error getCategories:', e.message);
      }
    }
    const all = [];
    categoriesStore.forEach(cats => all.push(...cats));
    return all;
  },

  async saveCategory(category) {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase
          .from('categories')
          .upsert(category, { onConflict: 'id' })
          .select();
        if (error) throw error;
        return data?.[0];
      } catch (e) {
        console.error('DB Error saveCategory:', e.message);
      }
    }
    if (!categoriesStore.has(1)) categoriesStore.set(1, []);
    const cats = categoriesStore.get(1);
    const idx = cats.findIndex(c => c.id === category.id);
    if (idx >= 0) cats[idx] = category;
    else cats.push(category);
    return category;
  },

  async deleteCategory(id) {
    if (useSupabase && supabase) {
      try {
        await supabase.from('categories').delete().eq('id', id);
      } catch (e) {
        console.error('DB Error deleteCategory:', e.message);
      }
    }
    categoriesStore.forEach((cats) => {
      const idx = cats.findIndex(c => c.id == id);
      if (idx >= 0) cats.splice(idx, 1);
    });
  },

  // PROMOÇÕES
  async getPromotions() {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase.from('promotions').select('*');
        if (error) throw error;
        return data || [];
      } catch (e) {
        console.error('DB Error getPromotions:', e.message);
      }
    }
    return Array.from(promotionsStore.values()).flat();
  },

  async savePromotion(promotion) {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase
          .from('promotions')
          .upsert(promotion, { onConflict: 'id' })
          .select();
        if (error) throw error;
        return data?.[0];
      } catch (e) {
        console.error('DB Error savePromotion:', e.message);
      }
    }
    if (!promotionsStore.has(1)) promotionsStore.set(1, []);
    const promos = promotionsStore.get(1);
    const idx = promos.findIndex(p => p.id === promotion.id);
    if (idx >= 0) promos[idx] = promotion;
    else promos.push(promotion);
    return promotion;
  },

  async deletePromotion(id) {
    if (useSupabase && supabase) {
      try {
        await supabase.from('promotions').delete().eq('id', id);
      } catch (e) {
        console.error('DB Error deletePromotion:', e.message);
      }
    }
    promotionsStore.forEach((promos) => {
      const idx = promos.findIndex(p => p.id == id);
      if (idx >= 0) promos.splice(idx, 1);
    });
  },

  // VENDAS
  async getSales(storeId = null) {
    if (useSupabase && supabase) {
      try {
        let query = supabase.from('sales').select('*');
        if (storeId) query = query.eq('store_id', storeId);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      } catch (e) {
        console.error('DB Error getSales:', e.message);
      }
    }
    if (storeId) return salesStore.get(storeId) || [];
    const all = [];
    salesStore.forEach(sales => all.push(...sales));
    return all;
  },

  async saveSale(sale) {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase
          .from('sales')
          .upsert(sale, { onConflict: 'sale_number' })
          .select();
        if (error) throw error;
        return data?.[0];
      } catch (e) {
        console.error('DB Error saveSale:', e.message);
      }
    }
    const storeId = sale.store_id || 1;
    if (!salesStore.has(storeId)) salesStore.set(storeId, []);
    const sales = salesStore.get(storeId);
    const idx = sales.findIndex(s => s.sale_number === sale.sale_number);
    if (idx >= 0) sales[idx] = sale;
    else sales.push(sale);
    return sale;
  },

  // LOJAS
  async getStores() {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase.from('stores').select('*');
        if (error) throw error;
        return data || [];
      } catch (e) {
        console.error('DB Error getStores:', e.message);
      }
    }
    return Array.from(stores.values());
  },

  async saveStore(store) {
    if (useSupabase && supabase) {
      try {
        const { data, error } = await supabase
          .from('stores')
          .upsert(store, { onConflict: 'id' })
          .select();
        if (error) throw error;
        return data?.[0];
      } catch (e) {
        console.error('DB Error saveStore:', e.message);
      }
    }
    stores.set(store.id, store);
    return store;
  },

  // Carregar dados iniciais do Supabase para cache
  async loadInitialData() {
    if (!useSupabase || !supabase) return;
    
    console.log('📥 Carregando dados do Supabase para cache...');
    
    try {
      // Carregar produtos
      const products = await this.getProducts();
      if (products.length > 0) {
        productsStore.set(1, products);
        console.log(`   ✅ ${products.length} produtos carregados`);
      }
      
      // Carregar categorias
      const categories = await this.getCategories();
      if (categories.length > 0) {
        categoriesStore.set(1, categories);
        console.log(`   ✅ ${categories.length} categorias carregadas`);
      }
      
      // Carregar promoções
      const promotions = await this.getPromotions();
      if (promotions.length > 0) {
        promotionsStore.set(1, promotions);
        console.log(`   ✅ ${promotions.length} promoções carregadas`);
      }
      
      // Carregar lojas
      const storesList = await this.getStores();
      storesList.forEach(s => stores.set(s.id, s));
      console.log(`   ✅ ${storesList.length} lojas carregadas`);
      
      // Carregar vendas
      const sales = await this.getSales();
      sales.forEach(s => {
        const storeId = s.store_id || 1;
        if (!salesStore.has(storeId)) salesStore.set(storeId, []);
        salesStore.get(storeId).push(s);
      });
      console.log(`   ✅ ${sales.length} vendas carregadas`);
      
    } catch (error) {
      console.error('❌ Erro ao carregar dados iniciais:', error.message);
    }
  }
};

// Carregar dados iniciais ao iniciar
if (useSupabase) {
  db.loadInitialData();
}

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

// Try to load data from files (only works in local/dev environment)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const DATA_DIR = !isVercel ? path.join(__dirname, 'data') : null;
const SALES_FILE = !isVercel ? path.join(DATA_DIR, 'sales.json') : null;
const STORES_FILE = !isVercel ? path.join(DATA_DIR, 'stores.json') : null;

if (!isVercel && DATA_DIR && !useSupabase) {
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
app.post('/api/sync/products/push', async (req, res) => {
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
      
      // ✅ SALVAR NO SUPABASE (se configurado)
      if (useSupabase && supabase) {
        console.log(`📦 Salvando ${products.length} produtos no Supabase...`);
        // Salvar em lotes de 100 para evitar timeout
        const batchSize = 100;
        for (let i = 0; i < products.length; i += batchSize) {
          const batch = products.slice(i, i + batchSize).map(p => ({
            ...p,
            store_id: storeId,
            updated_at: new Date().toISOString()
          }));
          try {
            const { error } = await supabase
              .from('products')
              .upsert(batch, { onConflict: 'id' });
            if (error) {
              console.error('Supabase batch error:', error.message);
            }
          } catch (e) {
            console.error('Supabase save error:', e.message);
          }
        }
        console.log(`✅ Produtos salvos no Supabase!`);
      }
    }

    // Store categories (merge with existing)
    if (categories && Array.isArray(categories) && categories.length > 0) {
      categories.forEach(cat => {
        categoriesStore.set(cat.id, cat);
      });
      console.log(`✅ Received ${categories.length} categories from store ${storeId} (Total: ${categoriesStore.size})`);
      
      // ✅ SALVAR CATEGORIAS NO SUPABASE
      if (useSupabase && supabase) {
        for (const cat of categories) {
          try {
            await supabase.from('categories').upsert({
              ...cat,
              updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
          } catch (e) {
            console.error('Supabase category error:', e.message);
          }
        }
      }
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

// =====================================
// MIGRAÇÃO DE DADOS PARA SUPABASE
// =====================================

// Endpoint para migrar todos os produtos em memória para o Supabase
app.post('/api/admin/migrate-to-cloud', checkOwnerAuth, async (req, res) => {
  if (!useSupabase || !supabase) {
    return res.status(400).json({ 
      error: 'Supabase não está configurado',
      message: 'Configure SUPABASE_URL e SUPABASE_KEY no Vercel'
    });
  }
  
  try {
    let totalProducts = 0;
    let totalCategories = 0;
    let totalPromotions = 0;
    let errors = [];
    
    // Migrar produtos
    console.log('🚀 Iniciando migração para Supabase...');
    
    for (const [storeId, products] of productsStore) {
      console.log(`📦 Migrando ${products.length} produtos da loja ${storeId}...`);
      
      const batchSize = 100;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize).map(p => ({
          ...p,
          store_id: storeId,
          updated_at: new Date().toISOString()
        }));
        
        const { error } = await supabase
          .from('products')
          .upsert(batch, { onConflict: 'id' });
        
        if (error) {
          errors.push(`Produtos batch ${i}: ${error.message}`);
        } else {
          totalProducts += batch.length;
        }
      }
    }
    
    // Migrar categorias
    for (const [id, category] of categoriesStore) {
      const { error } = await supabase
        .from('categories')
        .upsert({
          ...category,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      
      if (error) {
        errors.push(`Categoria ${id}: ${error.message}`);
      } else {
        totalCategories++;
      }
    }
    
    // Migrar promoções
    for (const [id, promo] of promotionsStore) {
      const { error } = await supabase
        .from('promotions')
        .upsert({
          ...promo,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
      
      if (error) {
        errors.push(`Promoção ${id}: ${error.message}`);
      } else {
        totalPromotions++;
      }
    }
    
    console.log(`✅ Migração concluída!`);
    console.log(`   - Produtos: ${totalProducts}`);
    console.log(`   - Categorias: ${totalCategories}`);
    console.log(`   - Promoções: ${totalPromotions}`);
    
    res.json({
      success: true,
      message: 'Migração concluída!',
      migrated: {
        products: totalProducts,
        categories: totalCategories,
        promotions: totalPromotions
      },
      errors: errors.length > 0 ? errors : null
    });
    
  } catch (error) {
    console.error('Erro na migração:', error);
    res.status(500).json({ error: 'Erro na migração', message: error.message });
  }
});

// Verificar status do Supabase
app.get('/api/admin/cloud-status', checkOwnerAuth, async (req, res) => {
  const status = {
    supabaseConfigured: useSupabase,
    supabaseConnected: false,
    productsInMemory: 0,
    productsInCloud: 0,
    categoriesInMemory: categoriesStore.size,
    categoriesInCloud: 0
  };
  
  // Contar produtos em memória
  productsStore.forEach(products => {
    status.productsInMemory += products.length;
  });
  
  // Verificar Supabase
  if (useSupabase && supabase) {
    try {
      const { count: productCount, error: pError } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true });
      
      const { count: categoryCount, error: cError } = await supabase
        .from('categories')
        .select('*', { count: 'exact', head: true });
      
      if (!pError && !cError) {
        status.supabaseConnected = true;
        status.productsInCloud = productCount || 0;
        status.categoriesInCloud = categoryCount || 0;
      }
    } catch (e) {
      console.error('Supabase status check error:', e.message);
    }
  }
  
  res.json(status);
});

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

// Listar todos os produtos (com paginação do servidor)
app.get('/api/admin/products', checkOwnerAuth, async (req, res) => {
  try {
    const { page = 1, limit = 0, search = '' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    let allProducts = [];
    
    // ✅ BUSCAR DO SUPABASE PRIMEIRO (se configurado)
    if (useSupabase && supabase) {
      console.log('📦 Buscando produtos do Supabase...');
      try {
        let query = supabase.from('products').select('*', { count: 'exact' });
        
        // Aplicar busca se fornecida
        if (search) {
          query = query.or(`name.ilike.%${search}%,barcode.ilike.%${search}%,sku.ilike.%${search}%`);
        }
        
        // Paginação
        if (limitNum > 0) {
          const start = (pageNum - 1) * limitNum;
          query = query.range(start, start + limitNum - 1);
        }
        
        const { data, error, count } = await query;
        
        if (!error && data) {
          console.log(`✅ ${data.length} produtos carregados do Supabase (total: ${count})`);
          return res.json({ 
            products: data, 
            total: count || data.length,
            page: pageNum,
            limit: limitNum,
            totalPages: limitNum > 0 ? Math.ceil((count || data.length) / limitNum) : 1,
            source: 'supabase'
          });
        } else if (error) {
          console.error('Supabase query error:', error.message);
        }
      } catch (e) {
        console.error('Supabase error:', e.message);
      }
    }
    
    // FALLBACK: Usar dados em memória
    console.log('📦 Usando dados em memória (fallback)...');
    const productsMap = new Map();
    
    productsStore.forEach((products, storeId) => {
      products.forEach(p => {
        const key = p.id || p.barcode || p.sku;
        if (key && !productsMap.has(key)) {
          productsMap.set(key, { ...p, source_store_id: storeId });
        }
      });
    });
    
    allProducts = Array.from(productsMap.values());
    
    // Aplicar busca no servidor se fornecida
    if (search) {
      const searchLower = search.toLowerCase();
      allProducts = allProducts.filter(p => 
        (p.name && p.name.toLowerCase().includes(searchLower)) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchLower)) ||
        (p.sku && p.sku.toLowerCase().includes(searchLower))
      );
    }
    
    const total = allProducts.length;
    
    // Paginação do servidor (se limit > 0)
    if (limitNum > 0) {
      const start = (pageNum - 1) * limitNum;
      allProducts = allProducts.slice(start, start + limitNum);
    }
    
    console.log('📦 Produtos carregados da memória:', allProducts.length, 'de', total, 'total');
    
    res.json({ 
      products: allProducts, 
      total: total,
      page: pageNum,
      limit: limitNum,
      totalPages: limitNum > 0 ? Math.ceil(total / limitNum) : 1,
      source: 'memory'
    });
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
app.post('/api/admin/products', checkOwnerAuth, async (req, res) => {
  try {
    const product = req.body;
    product.updated_at = new Date().toISOString();
    
    if (!product.id) {
      product.id = Date.now();
      product.created_at = new Date().toISOString();
    }

    // Salvar no banco de dados (Supabase ou memória)
    await db.saveProduct(product);
    
    // Também atualizar cache em memória
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
    
    console.log(`✅ Produto ${product.name} salvo com sucesso`);
    res.json({ success: true, product });
  } catch (error) {
    console.error('Error saving product:', error);
    res.status(500).json({ error: 'Erro ao salvar produto' });
  }
});

// Deletar produto
app.delete('/api/admin/products/:id', checkOwnerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Deletar do banco de dados
    await db.deleteProduct(parseInt(id));
    
    // Deletar do cache em memória
    productsStore.forEach((products, storeId) => {
      const index = products.findIndex(p => p.id == id);
      if (index >= 0) {
        products.splice(index, 1);
      }
    });
    
    res.json({ success: true, message: 'Produto deletado' });
  } catch (error) {
    console.error('Error deleting product:', error);
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
app.post('/api/admin/categories', checkOwnerAuth, async (req, res) => {
  try {
    const category = req.body;
    category.updated_at = new Date().toISOString();
    
    if (!category.id) {
      category.id = Date.now();
      category.created_at = new Date().toISOString();
    }

    // Salvar no banco de dados
    await db.saveCategory(category);

    // Atualizar cache em memória
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
    
    res.json({ success: true, category });
  } catch (error) {
    console.error('Error saving category:', error);
    res.status(500).json({ error: 'Erro ao salvar categoria' });
  }
});

// Deletar categoria
app.delete('/api/admin/categories/:id', checkOwnerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Deletar do banco de dados
    await db.deleteCategory(parseInt(id));
    
    // Deletar do cache em memória
    categoriesStore.forEach((categories) => {
      const index = categories.findIndex(c => c.id == id);
      if (index >= 0) {
        categories.splice(index, 1);
      }
    });
    
    res.json({ success: true, message: 'Categoria deletada' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Erro ao deletar categoria' });
  }
});

// Listar todas as promoções
app.get('/api/admin/promotions', checkOwnerAuth, async (req, res) => {
  try {
    // Buscar do Supabase primeiro
    if (useSupabase && supabase) {
      const { data, error } = await supabase
        .from('promotions')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (!error && data) {
        console.log(`📦 ${data.length} promoções carregadas do Supabase`);
        return res.json({ promotions: data, total: data.length, source: 'supabase' });
      }
    }
    
    // Fallback para memória
    const promotions = Array.from(promotionsStore.values()).flat();
    res.json({ promotions, total: promotions.length, source: 'memory' });
  } catch (error) {
    console.error('Error listing promotions:', error);
    res.status(500).json({ error: 'Erro ao listar promoções' });
  }
});

// Criar/Atualizar promoção
app.post('/api/admin/promotions', checkOwnerAuth, async (req, res) => {
  try {
    const promotion = req.body;
    promotion.updated_at = new Date().toISOString();
    
    if (!promotion.id) {
      promotion.id = Date.now();
      promotion.created_at = new Date().toISOString();
    }

    // Salvar no banco de dados
    await db.savePromotion(promotion);

    // Atualizar cache em memória
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
    
    console.log(`✅ Promoção salva: ${promotion.name || promotion.product_name}`);
    res.json({ success: true, promotion });
  } catch (error) {
    console.error('Error saving promotion:', error);
    res.status(500).json({ error: 'Erro ao salvar promoção' });
  }
});

// Deletar promoção
app.delete('/api/admin/promotions/:id', checkOwnerAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Deletar do banco de dados
    await db.deletePromotion(parseInt(id));
    
    // Deletar do cache em memória
    promotionsStore.forEach((promotions) => {
      const index = promotions.findIndex(p => p.id == id);
      if (index >= 0) {
        promotions.splice(index, 1);
      }
    });
    
    res.json({ success: true, message: 'Promoção deletada' });
  } catch (error) {
    console.error('Error deleting promotion:', error);
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
        <div class="flex gap-2 mt-3 flex-wrap">
          <button onclick="switchTab('dashboard')" class="tab-btn active px-4 py-2 rounded-lg text-sm font-medium bg-white/20">📊 Dashboard</button>
          <button onclick="switchTab('products')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">📦 Produtos</button>
          <button onclick="switchTab('categories')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">📁 Categorias</button>
          <button onclick="switchTab('promotions')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">🏷️ Promoções</button>
          <button onclick="switchTab('cloud')" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium bg-white/20">☁️ Nuvem</button>
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
          <!-- Header com título e botão -->
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-xl font-bold text-gray-800">📦 Gerenciar Produtos</h2>
              <p id="productsCount" class="text-sm text-gray-500">Carregando...</p>
            </div>
            <button onclick="openProductModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
              <span>➕</span> Novo Produto
            </button>
          </div>

          <!-- Filtros Avançados -->
          <div class="bg-gray-50 rounded-xl p-4 mb-4">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <!-- Busca -->
              <div class="lg:col-span-2">
                <label class="block text-xs font-medium text-gray-600 mb-1">🔍 Buscar</label>
                <input type="text" id="productSearch" placeholder="Nome, código ou barcode..." 
                  class="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" 
                  oninput="debounceSearch()">
              </div>
              <!-- Categoria -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">📁 Categoria</label>
                <select id="filterCategory" class="w-full px-3 py-2 border rounded-lg text-sm" onchange="filterProducts()">
                  <option value="">Todas</option>
                </select>
              </div>
              <!-- Departamento -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">🏢 Departamento</label>
                <select id="filterDepartment" class="w-full px-3 py-2 border rounded-lg text-sm" onchange="filterProducts()">
                  <option value="">Todos</option>
                </select>
              </div>
              <!-- Status -->
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">📊 Status</label>
                <select id="filterStatus" class="w-full px-3 py-2 border rounded-lg text-sm" onchange="filterProducts()">
                  <option value="">Todos</option>
                  <option value="active">Ativos</option>
                  <option value="inactive">Inativos</option>
                </select>
              </div>
            </div>
            <div class="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-600">Exibir:</span>
                <select id="productsPerPageSelect" class="px-2 py-1 border rounded text-sm" onchange="changeProductsPerPage()">
                  <option value="25">25</option>
                  <option value="50" selected>50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
                <span class="text-xs text-gray-600">por página</span>
              </div>
              <button onclick="clearProductFilters()" class="text-xs text-blue-600 hover:text-blue-800">
                🔄 Limpar filtros
              </button>
            </div>
          </div>

          <!-- Tabela de Produtos -->
          <div class="overflow-x-auto border rounded-lg">
            <table class="w-full">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-200" onclick="sortProducts('barcode')">
                    Código <span id="sort-barcode" class="text-gray-400">↕</span>
                  </th>
                  <th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-200" onclick="sortProducts('name')">
                    Nome <span id="sort-name" class="text-gray-400">↕</span>
                  </th>
                  <th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Categoria</th>
                  <th class="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Dept.</th>
                  <th class="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-200" onclick="sortProducts('price')">
                    Preço <span id="sort-price" class="text-gray-400">↕</span>
                  </th>
                  <th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                  <th class="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Ações</th>
                </tr>
              </thead>
              <tbody id="productsTableBody" class="divide-y divide-gray-100 bg-white">
                <tr><td colspan="7" class="text-center py-12 text-gray-400">
                  <div class="animate-pulse">⏳ Carregando produtos...</div>
                </td></tr>
              </tbody>
            </table>
          </div>

          <!-- Paginação Avançada -->
          <div class="flex items-center justify-between mt-4 px-2">
            <div id="paginationInfo" class="text-sm text-gray-600">
              Mostrando 0 de 0 produtos
            </div>
            <div class="flex items-center gap-1">
              <button onclick="goToProductPage(1)" class="px-3 py-1 rounded border hover:bg-gray-100 text-sm" title="Primeira página">⏮️</button>
              <button onclick="goToProductPage(productPage - 1)" class="px-3 py-1 rounded border hover:bg-gray-100 text-sm" title="Anterior">◀️</button>
              <div id="pageNumbers" class="flex gap-1"></div>
              <button onclick="goToProductPage(productPage + 1)" class="px-3 py-1 rounded border hover:bg-gray-100 text-sm" title="Próxima">▶️</button>
              <button onclick="goToProductPage(totalProductPages)" class="px-3 py-1 rounded border hover:bg-gray-100 text-sm" title="Última página">⏭️</button>
              <span class="mx-2 text-gray-400">|</span>
              <span class="text-sm text-gray-600">Ir para:</span>
              <input type="number" id="gotoPage" min="1" class="w-16 px-2 py-1 border rounded text-sm text-center" 
                onkeypress="if(event.key==='Enter')goToProductPage(parseInt(this.value))">
            </div>
          </div>
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

      <!-- TAB NUVEM / CLOUD -->
      <div id="tab-cloud" class="tab-content hidden">
        <div class="max-w-2xl mx-auto">
          <!-- Status Card -->
          <div class="bg-white rounded-xl p-6 card-shadow mb-6">
            <h2 class="text-xl font-bold text-gray-800 mb-4">☁️ Status da Nuvem</h2>
            <div id="cloudStatus" class="space-y-4">
              <div class="text-center py-8">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p class="text-gray-500 mt-2">Verificando conexão...</p>
              </div>
            </div>
          </div>
          
          <!-- Migration Card -->
          <div class="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl p-6 text-white card-shadow mb-6">
            <h2 class="text-xl font-bold mb-2">🚀 Migrar Dados para a Nuvem</h2>
            <p class="text-blue-100 mb-4">
              Envie todos os produtos, categorias e promoções do sistema local para o banco de dados na nuvem (Supabase).
              Assim você poderá acessar os dados mesmo quando o sistema local estiver fechado.
            </p>
            <button onclick="migrateToCloud()" id="migrateBtn" class="w-full py-3 bg-white text-blue-600 rounded-lg font-bold hover:bg-blue-50 transition-colors">
              ☁️ Migrar Agora
            </button>
            <div id="migrateProgress" class="hidden mt-4">
              <div class="bg-white/20 rounded-full h-2">
                <div id="migrateProgressBar" class="bg-white h-2 rounded-full transition-all" style="width: 0%"></div>
              </div>
              <p id="migrateStatus" class="text-center text-sm mt-2">Migrando...</p>
            </div>
          </div>
          
          <!-- Info Card -->
          <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
            <h3 class="font-bold text-yellow-800 mb-2">ℹ️ Importante</h3>
            <ul class="text-sm text-yellow-700 space-y-2">
              <li>• O Supabase precisa estar configurado no Vercel (SUPABASE_URL e SUPABASE_KEY)</li>
              <li>• A migração envia os dados que estão em memória no servidor</li>
              <li>• Para sincronizar novos produtos, use o botão "Sincronizar" no sistema local</li>
              <li>• Após a migração, os dados ficam salvos permanentemente na nuvem</li>
            </ul>
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
        <div class="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden mx-4">
          <div class="gradient-bg text-white px-6 py-4 flex justify-between items-center">
            <h2 id="productModalTitle" class="text-xl font-bold">Novo Produto</h2>
            <button onclick="closeProductModal()" class="p-2 hover:bg-white/20 rounded-lg">✕</button>
          </div>
          <form id="productForm" class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]" onsubmit="saveProduct(event)">
            <input type="hidden" id="productId">
            
            <!-- Tabs do Modal -->
            <div class="flex border-b mb-4">
              <button type="button" onclick="switchProductTab('info')" class="product-tab-btn px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600" data-tab="info">
                📋 Informações
              </button>
              <button type="button" onclick="switchProductTab('barcodes')" class="product-tab-btn px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="barcodes">
                📊 Códigos de Barras
              </button>
              <button type="button" onclick="switchProductTab('promos')" class="product-tab-btn px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700" data-tab="promos">
                🏷️ Promoções
              </button>
            </div>
            
            <!-- Tab Informações -->
            <div id="productTab-info" class="product-tab-content">
              <div class="grid grid-cols-2 gap-4">
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Nome do Produto *</label>
                  <input type="text" id="productName" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
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
            </div>
            
            <!-- Tab Códigos de Barras -->
            <div id="productTab-barcodes" class="product-tab-content hidden">
              <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h3 class="font-semibold text-blue-800 mb-1">📊 Códigos de Barras Múltiplos</h3>
                <p class="text-sm text-blue-700">
                  Adicione quantos códigos de barras precisar. O primeiro será o principal.
                  Útil para produtos com embalagens diferentes ou códigos alternativos.
                </p>
              </div>
              
              <!-- Adicionar novo barcode -->
              <div class="flex gap-2 mb-4">
                <input type="text" id="newBarcodeInput" placeholder="Digite ou escaneie o código de barras..." 
                  class="flex-1 px-3 py-2 border-2 rounded-lg focus:ring-2 focus:ring-green-500 font-mono"
                  onkeypress="if(event.key==='Enter'){event.preventDefault();addBarcode();}">
                <button type="button" onclick="addBarcode()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                  ➕ Adicionar
                </button>
              </div>
              
              <!-- Lista de barcodes -->
              <div id="barcodesList" class="space-y-2 max-h-[300px] overflow-y-auto">
                <div class="text-center py-4 text-gray-400">
                  Nenhum código de barras cadastrado
                </div>
              </div>
              
              <!-- Contador -->
              <div id="barcodesCount" class="text-sm text-gray-500 mt-2 text-right">
                0 códigos de barras
              </div>
            </div>
            
            <!-- Tab Promoções -->
            <div id="productTab-promos" class="product-tab-content hidden">
              <div class="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <h3 class="font-semibold text-yellow-800 mb-1">🏷️ Promoções do Produto</h3>
                <p class="text-sm text-yellow-700">
                  Crie e gerencie promoções diretamente para este produto.
                </p>
              </div>
              
              <!-- Promoções Ativas -->
              <div class="mb-4">
                <div class="flex justify-between items-center mb-3">
                  <h4 class="font-medium text-gray-700">Promoções Ativas</h4>
                  <span id="productPromosCount" class="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">0 promoções</span>
                </div>
                <div id="productPromosList" class="space-y-2 max-h-[200px] overflow-y-auto">
                  <div class="text-center py-4 text-gray-400">
                    Nenhuma promoção ativa para este produto
                  </div>
                </div>
              </div>
              
              <!-- Criar Promoção Rápida -->
              <div class="border-t pt-4">
                <h4 class="font-medium text-gray-700 mb-3">➕ Criar Promoção Rápida</h4>
                
                <!-- Tipo de Promoção -->
                <div class="grid grid-cols-2 gap-2 mb-4">
                  <button type="button" onclick="selectQuickPromoType('fixed_price')" class="quick-promo-btn p-3 border-2 rounded-lg text-left hover:bg-blue-50 transition-colors" data-type="fixed_price">
                    <span class="text-lg">💲</span>
                    <span class="text-sm font-medium">Preço Fixo</span>
                  </button>
                  <button type="button" onclick="selectQuickPromoType('multi_buy')" class="quick-promo-btn p-3 border-2 rounded-lg text-left hover:bg-green-50 transition-colors" data-type="multi_buy">
                    <span class="text-lg">📦</span>
                    <span class="text-sm font-medium">Leve X por $Y</span>
                  </button>
                  <button type="button" onclick="selectQuickPromoType('buy_get')" class="quick-promo-btn p-3 border-2 rounded-lg text-left hover:bg-purple-50 transition-colors" data-type="buy_get">
                    <span class="text-lg">🎁</span>
                    <span class="text-sm font-medium">Compre X Leve Y</span>
                  </button>
                  <button type="button" onclick="selectQuickPromoType('percent_off')" class="quick-promo-btn p-3 border-2 rounded-lg text-left hover:bg-orange-50 transition-colors" data-type="percent_off">
                    <span class="text-lg">📊</span>
                    <span class="text-sm font-medium">Desconto %</span>
                  </button>
                </div>
                
                <!-- Campos da Promoção Rápida -->
                <div id="quickPromoFields" class="hidden">
                  <!-- Preço Fixo -->
                  <div id="quickPromoFixed" class="quick-promo-field hidden">
                    <div class="bg-blue-50 rounded-lg p-4">
                      <label class="block text-sm font-medium text-gray-700 mb-2">Preço Promocional *</label>
                      <div class="flex items-center gap-2">
                        <span class="text-gray-500">$</span>
                        <input type="number" step="0.01" id="quickPromoPrice" class="flex-1 px-3 py-2 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 text-lg font-bold" placeholder="0.00">
                      </div>
                      <p id="quickPromoSavings" class="text-sm text-green-600 mt-2"></p>
                    </div>
                  </div>
                  
                  <!-- Leve X por $Y -->
                  <div id="quickPromoMultiBuy" class="quick-promo-field hidden">
                    <div class="bg-green-50 rounded-lg p-4">
                      <div class="grid grid-cols-3 gap-3 items-center">
                        <div>
                          <label class="block text-xs font-medium text-gray-700 mb-1">Leve</label>
                          <input type="number" id="quickPromoQty" min="2" value="2" class="w-full px-3 py-2 border rounded-lg text-center font-bold">
                        </div>
                        <div class="text-center text-xl font-bold text-green-600">por</div>
                        <div>
                          <label class="block text-xs font-medium text-gray-700 mb-1">Valor $</label>
                          <input type="number" step="0.01" id="quickPromoMultiPrice" class="w-full px-3 py-2 border rounded-lg text-center font-bold" placeholder="0.00">
                        </div>
                      </div>
                      <p id="quickPromoMultiSavings" class="text-sm text-green-600 mt-2 text-center"></p>
                    </div>
                  </div>
                  
                  <!-- Compre X Leve Y -->
                  <div id="quickPromoBuyGet" class="quick-promo-field hidden">
                    <div class="bg-purple-50 rounded-lg p-4">
                      <div class="grid grid-cols-3 gap-3 items-center">
                        <div>
                          <label class="block text-xs font-medium text-gray-700 mb-1">Compre</label>
                          <input type="number" id="quickPromoBuy" min="1" value="2" class="w-full px-3 py-2 border rounded-lg text-center font-bold">
                        </div>
                        <div class="text-center text-xl font-bold text-purple-600">Leve</div>
                        <div>
                          <label class="block text-xs font-medium text-gray-700 mb-1">Unidades</label>
                          <input type="number" id="quickPromoGet" min="2" value="3" class="w-full px-3 py-2 border rounded-lg text-center font-bold">
                        </div>
                      </div>
                      <p id="quickPromoBuyGetInfo" class="text-sm text-purple-600 mt-2 text-center"></p>
                    </div>
                  </div>
                  
                  <!-- Desconto % -->
                  <div id="quickPromoPercent" class="quick-promo-field hidden">
                    <div class="bg-orange-50 rounded-lg p-4">
                      <div class="flex items-center justify-center gap-2">
                        <input type="number" id="quickPromoPercentValue" min="1" max="99" value="20" class="w-24 px-3 py-2 border rounded-lg text-center text-2xl font-bold">
                        <span class="text-2xl font-bold text-orange-600">%</span>
                        <span class="text-gray-600">de desconto</span>
                      </div>
                      <p id="quickPromoPercentInfo" class="text-sm text-orange-600 mt-2 text-center"></p>
                    </div>
                  </div>
                  
                  <!-- Datas -->
                  <div class="grid grid-cols-2 gap-3 mt-4">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">Data Início</label>
                      <input type="date" id="quickPromoStart" class="w-full px-3 py-2 border rounded-lg">
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">Data Fim</label>
                      <input type="date" id="quickPromoEnd" class="w-full px-3 py-2 border rounded-lg">
                    </div>
                  </div>
                  
                  <!-- Botão Salvar -->
                  <button type="button" onclick="saveQuickPromo()" class="w-full mt-4 px-4 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-lg hover:from-yellow-600 hover:to-orange-600 font-bold">
                    🏷️ Criar Promoção
                  </button>
                </div>
              </div>
            </div>
            
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button type="button" onclick="closeProductModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">💾 Salvar Produto</button>
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
        <div class="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-hidden mx-4">
          <div class="gradient-bg text-white px-6 py-4 flex justify-between items-center">
            <h2 id="promotionModalTitle" class="text-xl font-bold">Nova Promoção</h2>
            <button onclick="closePromotionModal()" class="p-2 hover:bg-white/20 rounded-lg">✕</button>
          </div>
          <form id="promotionForm" class="p-6 overflow-y-auto max-h-[calc(90vh-100px)]" onsubmit="savePromotion(event)">
            <input type="hidden" id="promotionId">
            <div class="space-y-4">
              <!-- Nome da Promoção -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Nome da Promoção *</label>
                <input type="text" id="promotionName" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Ex: Refrigerante 2 por $4">
              </div>
              
              <!-- Produto -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Produto (Barcode ou ID)</label>
                <input type="text" id="promotionProduct" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="Digite o código de barras">
              </div>
              
              <!-- Tipo de Promoção -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">🏷️ Tipo de Promoção</label>
                <div class="grid grid-cols-1 gap-2">
                  <label class="flex items-center p-3 border-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors promo-type-option" onclick="selectPromoType('fixed_price')">
                    <input type="radio" name="promoType" value="fixed_price" checked class="mr-3">
                    <div>
                      <span class="font-medium">💲 Preço Fixo</span>
                      <p class="text-xs text-gray-500">Ex: De $2.99 por $1.99</p>
                    </div>
                  </label>
                  <label class="flex items-center p-3 border-2 rounded-lg cursor-pointer hover:bg-green-50 transition-colors promo-type-option" onclick="selectPromoType('multi_buy')">
                    <input type="radio" name="promoType" value="multi_buy" class="mr-3">
                    <div>
                      <span class="font-medium">📦 Leve X por $Y</span>
                      <p class="text-xs text-gray-500">Ex: Leve 2 por $4.00</p>
                    </div>
                  </label>
                  <label class="flex items-center p-3 border-2 rounded-lg cursor-pointer hover:bg-purple-50 transition-colors promo-type-option" onclick="selectPromoType('buy_get')">
                    <input type="radio" name="promoType" value="buy_get" class="mr-3">
                    <div>
                      <span class="font-medium">🎁 Compre X Leve Y</span>
                      <p class="text-xs text-gray-500">Ex: Compre 2 Leve 3</p>
                    </div>
                  </label>
                  <label class="flex items-center p-3 border-2 rounded-lg cursor-pointer hover:bg-orange-50 transition-colors promo-type-option" onclick="selectPromoType('percent_off')">
                    <input type="radio" name="promoType" value="percent_off" class="mr-3">
                    <div>
                      <span class="font-medium">📊 Desconto %</span>
                      <p class="text-xs text-gray-500">Ex: 20% de desconto</p>
                    </div>
                  </label>
                  <label class="flex items-center p-3 border-2 rounded-lg cursor-pointer hover:bg-pink-50 transition-colors promo-type-option" onclick="selectPromoType('mix_match')">
                    <input type="radio" name="promoType" value="mix_match" class="mr-3">
                    <div>
                      <span class="font-medium">🎨 Mix and Match</span>
                      <p class="text-xs text-gray-500">Ex: Escolha 3 produtos por $10</p>
                    </div>
                  </label>
                </div>
              </div>
              
              <!-- Campos para Preço Fixo -->
              <div id="fixedPriceFields" class="promo-fields">
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Preço Original</label>
                    <input type="number" step="0.01" id="promotionRegularPrice" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="2.99">
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Preço Promocional *</label>
                    <input type="number" step="0.01" id="promotionPrice" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500" placeholder="1.99">
                  </div>
                </div>
              </div>
              
              <!-- Campos para Leve X por $Y -->
              <div id="multiBuyFields" class="promo-fields hidden">
                <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div class="grid grid-cols-3 gap-3 items-end">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Leve</label>
                      <input type="number" id="multiBuyQty" min="2" value="2" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 text-center text-lg font-bold">
                    </div>
                    <div class="text-center pb-2">
                      <span class="text-2xl font-bold text-green-600">por</span>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Valor $</label>
                      <input type="number" step="0.01" id="multiBuyPrice" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 text-center text-lg font-bold" placeholder="4.00">
                    </div>
                  </div>
                  <div class="mt-3 text-center">
                    <span id="multiBuyPreview" class="text-sm text-green-700 font-medium">Preço unitário na promoção: $2.00</span>
                  </div>
                </div>
              </div>
              
              <!-- Campos para Compre X Leve Y -->
              <div id="buyGetFields" class="promo-fields hidden">
                <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div class="grid grid-cols-3 gap-3 items-end">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Compre</label>
                      <input type="number" id="buyGetBuy" min="1" value="2" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-center text-lg font-bold">
                    </div>
                    <div class="text-center pb-2">
                      <span class="text-2xl font-bold text-purple-600">Leve</span>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Unidades</label>
                      <input type="number" id="buyGetGet" min="2" value="3" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 text-center text-lg font-bold">
                    </div>
                  </div>
                  <div class="mt-3 text-center">
                    <span id="buyGetPreview" class="text-sm text-purple-700 font-medium">Cliente paga 2, leva 3 (1 grátis!)</span>
                  </div>
                </div>
              </div>
              
              <!-- Campos para Desconto % -->
              <div id="percentOffFields" class="promo-fields hidden">
                <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div class="flex items-center justify-center gap-3">
                    <input type="number" id="percentOffValue" min="1" max="100" value="20" class="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 text-center text-2xl font-bold">
                    <span class="text-3xl font-bold text-orange-600">%</span>
                    <span class="text-lg text-gray-600">de desconto</span>
                  </div>
                </div>
              </div>
              
              <!-- Campos para Mix and Match -->
              <div id="mixMatchFields" class="promo-fields hidden">
                <div class="bg-pink-50 border border-pink-200 rounded-lg p-4">
                  <div class="text-center mb-3">
                    <span class="text-2xl">🎨</span>
                    <p class="text-sm text-pink-700 font-medium">Misture e Combine - Escolha produtos de um grupo</p>
                  </div>
                  <div class="grid grid-cols-3 gap-3 items-end mb-3">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Escolha</label>
                      <input type="number" id="mixMatchQty" min="2" value="3" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-pink-500 text-center text-lg font-bold">
                    </div>
                    <div class="text-center pb-2">
                      <span class="text-xl font-bold text-pink-600">itens por</span>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-1">Valor $</label>
                      <input type="number" step="0.01" id="mixMatchPrice" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-pink-500 text-center text-lg font-bold" placeholder="10.00">
                    </div>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">📁 Nome do Grupo</label>
                    <input type="text" id="mixMatchGroup" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-pink-500" placeholder="Ex: Laticínios, Refrigerantes, Frutas...">
                  </div>
                  <div class="mt-3 text-center">
                    <span id="mixMatchPreview" class="text-sm text-pink-700 font-medium">Escolha 3 itens e pague apenas $10.00!</span>
                  </div>
                </div>
                
                <!-- Busca de Produtos -->
                <div class="mt-4 border-t pt-4">
                  <label class="block text-sm font-medium text-gray-700 mb-2">🔍 Adicionar Produtos à Promoção</label>
                  <div class="relative">
                    <input type="text" id="promoProductSearch" 
                      class="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500" 
                      placeholder="Buscar por nome, código de barras ou SKU..."
                      oninput="searchProductsForPromo(this.value)"
                      onfocus="showPromoProductResults()">
                    <div id="promoProductResults" class="absolute z-50 w-full bg-white border-2 border-pink-200 rounded-lg shadow-xl mt-1 max-h-60 overflow-y-auto hidden">
                      <!-- Resultados da busca aparecem aqui -->
                    </div>
                  </div>
                  
                  <!-- Produtos Selecionados -->
                  <div class="mt-3">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm font-medium text-gray-700">📦 Produtos Selecionados</span>
                      <span id="selectedProductsCount" class="text-xs bg-pink-100 text-pink-700 px-2 py-1 rounded-full">0 produtos</span>
                    </div>
                    <div id="selectedProductsList" class="min-h-[60px] max-h-[150px] overflow-y-auto bg-gray-50 rounded-lg p-2 border-2 border-dashed border-gray-300">
                      <p class="text-center text-gray-400 text-sm py-4">Nenhum produto adicionado</p>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- Seletor de Produto para outros tipos (Multi-buy, etc) -->
              <div id="productSelectorSection" class="mt-4 border-t pt-4">
                <label class="block text-sm font-medium text-gray-700 mb-2">🔍 Buscar Produto para Promoção</label>
                <div class="relative">
                  <input type="text" id="singleProductSearch" 
                    class="w-full px-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500" 
                    placeholder="Buscar por nome, código de barras ou SKU..."
                    oninput="searchSingleProduct(this.value)"
                    onfocus="showSingleProductResults()">
                  <div id="singleProductResults" class="absolute z-50 w-full bg-white border-2 border-blue-200 rounded-lg shadow-xl mt-1 max-h-60 overflow-y-auto hidden">
                    <!-- Resultados aparecem aqui -->
                  </div>
                </div>
                <div id="selectedSingleProduct" class="mt-2 hidden">
                  <!-- Produto selecionado aparece aqui -->
                </div>
              </div>
              
              <!-- Datas -->
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">📅 Data Início</label>
                  <input type="date" id="promotionStartDate" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">📅 Data Fim</label>
                  <input type="date" id="promotionEndDate" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
                </div>
              </div>
              
              <!-- Ativa -->
              <div class="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                <input type="checkbox" id="promotionActive" checked class="w-5 h-5 text-green-600">
                <label class="text-sm text-gray-700 font-medium">✅ Promoção Ativa</label>
              </div>
            </div>
            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button type="button" onclick="closePromotionModal()" class="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">💾 Salvar Promoção</button>
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
    let filteredProducts = [];
    let allCategories = [];
    let allPromotions = [];
    let allDepartments = [];
    let productPage = 1;
    let productsPerPage = 50;
    let totalProductPages = 1;
    let productSortField = 'name';
    let productSortDirection = 'asc';
    let searchTimeout = null;

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
      else if (tab === 'cloud') loadCloudStatus();
    }

    function refreshCurrentTab() {
      switchTab(currentTab);
    }

    // =====================
    // CLOUD / NUVEM MANAGEMENT
    // =====================
    
    async function loadCloudStatus() {
      const statusDiv = document.getElementById('cloudStatus');
      
      try {
        const response = await fetch('/api/admin/cloud-status?password=' + sessionStorage.getItem('token'));
        const status = await response.json();
        
        const supabaseStatus = status.supabaseConnected 
          ? '<span class="text-green-600 font-bold">✅ Conectado</span>'
          : status.supabaseConfigured 
            ? '<span class="text-yellow-600 font-bold">⚠️ Configurado mas não conectado</span>'
            : '<span class="text-red-600 font-bold">❌ Não configurado</span>';
        
        statusDiv.innerHTML = 
          '<div class="grid grid-cols-2 gap-4">' +
            '<div class="bg-gray-50 rounded-lg p-4">' +
              '<p class="text-sm text-gray-500">Status Supabase</p>' +
              '<p class="text-lg">' + supabaseStatus + '</p>' +
            '</div>' +
            '<div class="bg-gray-50 rounded-lg p-4">' +
              '<p class="text-sm text-gray-500">Dados em Memória</p>' +
              '<p class="text-lg font-bold text-blue-600">' + status.productsInMemory.toLocaleString() + ' produtos</p>' +
              '<p class="text-xs text-gray-400">' + status.categoriesInMemory + ' categorias</p>' +
            '</div>' +
            '<div class="bg-gray-50 rounded-lg p-4">' +
              '<p class="text-sm text-gray-500">Dados na Nuvem</p>' +
              '<p class="text-lg font-bold text-green-600">' + status.productsInCloud.toLocaleString() + ' produtos</p>' +
              '<p class="text-xs text-gray-400">' + status.categoriesInCloud + ' categorias</p>' +
            '</div>' +
            '<div class="bg-gray-50 rounded-lg p-4">' +
              '<p class="text-sm text-gray-500">Sincronização</p>' +
              '<p class="text-lg">' + (status.productsInCloud >= status.productsInMemory 
                ? '<span class="text-green-600">✅ Atualizado</span>' 
                : '<span class="text-yellow-600">⚠️ Pendente</span>') + '</p>' +
            '</div>' +
          '</div>';
          
        // Mostrar alerta se não configurado
        if (!status.supabaseConfigured) {
          statusDiv.innerHTML += 
            '<div class="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">' +
              '<p class="text-red-700 font-medium">⚠️ Supabase não configurado!</p>' +
              '<p class="text-sm text-red-600 mt-1">Configure as variáveis SUPABASE_URL e SUPABASE_KEY no Vercel para salvar dados permanentemente.</p>' +
            '</div>';
        }
        
      } catch (error) {
        statusDiv.innerHTML = '<div class="text-center py-4 text-red-500">Erro ao carregar status: ' + error.message + '</div>';
      }
    }
    
    async function migrateToCloud() {
      const btn = document.getElementById('migrateBtn');
      const progress = document.getElementById('migrateProgress');
      const progressBar = document.getElementById('migrateProgressBar');
      const status = document.getElementById('migrateStatus');
      
      if (!confirm('Deseja migrar todos os dados para a nuvem?\\n\\nIsso vai enviar produtos, categorias e promoções para o Supabase.')) {
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Migrando...';
      progress.classList.remove('hidden');
      progressBar.style.width = '30%';
      status.textContent = 'Enviando dados para a nuvem...';
      
      try {
        const response = await fetch('/api/admin/migrate-to-cloud', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Owner-Password': sessionStorage.getItem('token')
          }
        });
        
        progressBar.style.width = '100%';
        
        const result = await response.json();
        
        if (result.success) {
          status.textContent = '✅ Migração concluída!';
          showToast('Migração concluída! ' + result.migrated.products + ' produtos enviados.', 'success');
          
          // Recarregar status
          setTimeout(() => {
            loadCloudStatus();
            progress.classList.add('hidden');
            btn.disabled = false;
            btn.textContent = '☁️ Migrar Agora';
          }, 2000);
        } else {
          throw new Error(result.error || result.message);
        }
        
      } catch (error) {
        status.textContent = '❌ Erro: ' + error.message;
        showToast('Erro na migração: ' + error.message, 'error');
        btn.disabled = false;
        btn.textContent = '☁️ Tentar Novamente';
      }
    }

    // =====================
    // PRODUCTS MANAGEMENT (Otimizado para 20k+ produtos)
    // =====================
    let totalProductsInServer = 0;
    let isLoadingProducts = false;
    let useServerPagination = true; // Usar paginação do servidor para grandes volumes
    
    async function loadProducts() {
      if (isLoadingProducts) return;
      isLoadingProducts = true;
      
      try {
        document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-12 text-gray-400"><div class="animate-pulse">⏳ Carregando produtos...</div></td></tr>';
        
        // Carregar categorias primeiro
        await loadCategoriesForSelect();
        
        // Verificar quantos produtos existem
        const countResponse = await fetch(API_BASE + '/api/admin/products?password=' + encodeURIComponent(password) + '&limit=1');
        const countData = await countResponse.json();
        totalProductsInServer = countData.total || 0;
        
        document.getElementById('productsCount').textContent = totalProductsInServer.toLocaleString('pt-BR') + ' produtos cadastrados';
        
        // Se tem menos de 5000 produtos, carrega tudo (mais rápido para filtros locais)
        // Se tem mais, usa paginação do servidor
        if (totalProductsInServer <= 5000) {
          useServerPagination = false;
          await loadAllProductsInBatches();
        } else {
          useServerPagination = true;
          allProducts = [];
          // Carregar departamentos do primeiro lote
          const deptResponse = await fetch(API_BASE + '/api/admin/products?password=' + encodeURIComponent(password) + '&limit=1000');
          const deptData = await deptResponse.json();
          allDepartments = [...new Set((deptData.products || []).map(p => p.department).filter(d => d))].sort();
          populateFilters();
          await loadProductsFromServer();
        }
        
      } catch (error) {
        console.error('Error loading products:', error);
        document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-12 text-red-400">❌ Erro ao carregar produtos. <button onclick="loadProducts()" class="text-blue-600 underline">Tentar novamente</button></td></tr>';
      } finally {
        isLoadingProducts = false;
      }
    }

    // Carregar todos os produtos em lotes (para menos de 5000 produtos)
    async function loadAllProductsInBatches() {
      const batchSize = 2000;
      allProducts = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-12 text-gray-400"><div class="animate-pulse">⏳ Carregando produtos... ' + allProducts.length + ' / ' + totalProductsInServer + '</div></td></tr>';
        
        const response = await fetch(API_BASE + '/api/admin/products?password=' + encodeURIComponent(password) + '&page=' + page + '&limit=' + batchSize);
        const data = await response.json();
        
        if (data.products && data.products.length > 0) {
          allProducts = allProducts.concat(data.products);
          page++;
        }
        
        hasMore = data.products && data.products.length === batchSize;
      }
      
      // Extrair departamentos únicos
      allDepartments = [...new Set(allProducts.map(p => p.department).filter(d => d))].sort();
      populateFilters();
      filterProducts();
    }

    // Carregar produtos do servidor com paginação (para mais de 5000 produtos)
    async function loadProductsFromServer() {
      const search = document.getElementById('productSearch').value.trim();
      
      document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-12 text-gray-400"><div class="animate-pulse">⏳ Carregando página ' + productPage + '...</div></td></tr>';
      
      try {
        let url = API_BASE + '/api/admin/products?password=' + encodeURIComponent(password) + 
                  '&page=' + productPage + '&limit=' + productsPerPage;
        
        if (search) {
          url += '&search=' + encodeURIComponent(search);
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        filteredProducts = data.products || [];
        totalProductPages = data.totalPages || 1;
        totalProductsInServer = data.total || 0;
        
        document.getElementById('productsCount').textContent = totalProductsInServer.toLocaleString('pt-BR') + ' produtos' + (search ? ' encontrados' : ' cadastrados');
        
        renderProducts();
      } catch (error) {
        console.error('Error loading products from server:', error);
        document.getElementById('productsTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-12 text-red-400">❌ Erro ao carregar. <button onclick="loadProductsFromServer()" class="text-blue-600 underline">Tentar novamente</button></td></tr>';
      }
    }

    function populateFilters() {
      // Categorias
      const catSelect = document.getElementById('filterCategory');
      catSelect.innerHTML = '<option value="">Todas (' + allCategories.length + ')</option>' +
        allCategories.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
      
      // Departamentos
      const deptSelect = document.getElementById('filterDepartment');
      deptSelect.innerHTML = '<option value="">Todos (' + allDepartments.length + ')</option>' +
        allDepartments.map(d => '<option value="' + d + '">' + d + '</option>').join('');
    }

    function debounceSearch() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        productPage = 1;
        if (useServerPagination) {
          loadProductsFromServer();
        } else {
          filterProducts();
        }
      }, 500); // 500ms para dar tempo de digitar
    }

    function filterProducts() {
      if (useServerPagination) {
        // Com paginação do servidor, apenas recarregar
        loadProductsFromServer();
        return;
      }
      
      const search = document.getElementById('productSearch').value.toLowerCase().trim();
      const categoryFilter = document.getElementById('filterCategory').value;
      const deptFilter = document.getElementById('filterDepartment').value;
      const statusFilter = document.getElementById('filterStatus').value;
      
      filteredProducts = allProducts.filter(p => {
        // Busca por texto
        const matchSearch = !search || 
          (p.name && p.name.toLowerCase().includes(search)) ||
          (p.barcode && p.barcode.toLowerCase().includes(search)) ||
          (p.sku && p.sku.toLowerCase().includes(search));
        
        // Filtro por categoria
        const matchCategory = !categoryFilter || p.category_id == categoryFilter;
        
        // Filtro por departamento
        const matchDept = !deptFilter || p.department === deptFilter;
        
        // Filtro por status
        const matchStatus = !statusFilter || 
          (statusFilter === 'active' && p.is_active !== false) ||
          (statusFilter === 'inactive' && p.is_active === false);
        
        return matchSearch && matchCategory && matchDept && matchStatus;
      });
      
      // Ordenar
      sortProductsArray();
      
      // Atualizar paginação
      totalProductPages = Math.ceil(filteredProducts.length / productsPerPage);
      if (productPage > totalProductPages) productPage = Math.max(1, totalProductPages);
      
      renderProducts();
    }

    function sortProducts(field) {
      if (productSortField === field) {
        productSortDirection = productSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        productSortField = field;
        productSortDirection = 'asc';
      }
      
      // Atualizar indicadores visuais
      document.querySelectorAll('[id^="sort-"]').forEach(el => el.textContent = '↕');
      const sortIndicator = document.getElementById('sort-' + field);
      if (sortIndicator) {
        sortIndicator.textContent = productSortDirection === 'asc' ? '↑' : '↓';
      }
      
      if (!useServerPagination) {
        sortProductsArray();
        renderProducts();
      }
    }

    function sortProductsArray() {
      filteredProducts.sort((a, b) => {
        let aVal = a[productSortField] || '';
        let bVal = b[productSortField] || '';
        
        if (productSortField === 'price') {
          aVal = parseFloat(aVal) || 0;
          bVal = parseFloat(bVal) || 0;
        } else {
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
        }
        
        if (aVal < bVal) return productSortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return productSortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }

    function renderProducts() {
      let start, end, paged;
      
      if (useServerPagination) {
        // Com paginação do servidor, os dados já vêm paginados
        start = (productPage - 1) * productsPerPage;
        end = start + filteredProducts.length;
        paged = filteredProducts;
      } else {
        // Paginação local
        start = (productPage - 1) * productsPerPage;
        end = start + productsPerPage;
        paged = filteredProducts.slice(start, end);
      }
      
      const tbody = document.getElementById('productsTableBody');
      
      if (paged.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-12 text-gray-400">' +
          '<p class="text-2xl mb-2">📦</p>' +
          '<p>Nenhum produto encontrado</p>' +
          '<p class="text-sm">Tente ajustar os filtros</p>' +
        '</td></tr>';
        updatePaginationInfo(0, 0, 0);
        return;
      }

      tbody.innerHTML = paged.map((p, idx) => {
        const category = allCategories.find(c => c.id === p.category_id);
        const rowNum = start + idx + 1;
        
        // Contar códigos de barras
        let barcodeCount = 0;
        if (p.barcode) barcodeCount = 1;
        if (p.barcodes && Array.isArray(p.barcodes)) barcodeCount = p.barcodes.length;
        else if (p.all_barcodes && Array.isArray(p.all_barcodes)) barcodeCount = p.all_barcodes.length;
        
        const hasMultipleBarcodes = barcodeCount > 1;
        
        return '<tr class="table-row hover:bg-blue-50 transition-colors">' +
          '<td class="px-3 py-2">' +
            '<div class="flex items-center gap-1">' +
              '<span class="font-mono text-xs bg-gray-100 px-2 py-1 rounded truncate max-w-[100px]" title="' + (p.barcode || p.sku || p.id) + '">' + 
                (p.barcode || p.sku || p.id) + 
              '</span>' +
              (hasMultipleBarcodes ? '<span class="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full" title="' + barcodeCount + ' códigos de barras">+' + (barcodeCount - 1) + '</span>' : '') +
            '</div>' +
          '</td>' +
          '<td class="px-3 py-2">' +
            '<div class="font-medium text-gray-800 truncate max-w-[250px]" title="' + (p.name || '') + '">' + (p.name || 'Sem nome') + '</div>' +
            (p.name_pt && p.name_pt !== p.name ? '<div class="text-xs text-gray-400 truncate">' + p.name_pt + '</div>' : '') +
          '</td>' +
          '<td class="px-3 py-2 text-sm text-gray-600">' + (category ? category.name : '-') + '</td>' +
          '<td class="px-3 py-2 text-xs text-gray-500">' + (p.department || '-') + '</td>' +
          '<td class="px-3 py-2 text-right font-bold text-green-600">$' + (p.price || 0).toFixed(2) + '</td>' +
          '<td class="px-3 py-2 text-center">' +
            (p.is_active !== false 
              ? '<span class="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">✓</span>' 
              : '<span class="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">✗</span>') +
          '</td>' +
          '<td class="px-3 py-2 text-center">' +
            '<button onclick="editProduct(' + p.id + ')" class="p-1 text-blue-600 hover:bg-blue-100 rounded" title="Editar">✏️</button>' +
            '<button onclick="deleteProduct(' + p.id + ')" class="p-1 text-red-600 hover:bg-red-100 rounded" title="Excluir">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      updatePaginationInfo(start + 1, Math.min(end, filteredProducts.length), filteredProducts.length);
      renderPagination();
    }

    function updatePaginationInfo(from, to, total) {
      const displayTotal = useServerPagination ? totalProductsInServer : total;
      document.getElementById('paginationInfo').textContent = 
        'Mostrando ' + from.toLocaleString('pt-BR') + '-' + to.toLocaleString('pt-BR') + 
        ' de ' + displayTotal.toLocaleString('pt-BR') + ' produtos';
      document.getElementById('gotoPage').max = totalProductPages;
      document.getElementById('gotoPage').placeholder = productPage;
    }

    function renderPagination() {
      const pageNumbers = document.getElementById('pageNumbers');
      pageNumbers.innerHTML = '';
      
      // Mostrar no máximo 7 páginas
      let startPage = Math.max(1, productPage - 3);
      let endPage = Math.min(totalProductPages, startPage + 6);
      if (endPage - startPage < 6) {
        startPage = Math.max(1, endPage - 6);
      }
      
      if (startPage > 1) {
        pageNumbers.innerHTML += '<span class="px-2 text-gray-400">...</span>';
      }
      
      for (let i = startPage; i <= endPage; i++) {
        const isActive = i === productPage;
        pageNumbers.innerHTML += '<button onclick="goToProductPage(' + i + ')" class="px-3 py-1 rounded text-sm ' + 
          (isActive ? 'bg-blue-600 text-white' : 'border hover:bg-gray-100') + '">' + i + '</button>';
      }
      
      if (endPage < totalProductPages) {
        pageNumbers.innerHTML += '<span class="px-2 text-gray-400">...</span>';
      }
    }

    function goToProductPage(page) {
      if (page < 1 || page > totalProductPages) return;
      productPage = page;
      
      if (useServerPagination) {
        loadProductsFromServer();
      } else {
        renderProducts();
      }
      
      // Scroll para o topo da tabela
      document.getElementById('tab-products').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function changeProductsPerPage() {
      productsPerPage = parseInt(document.getElementById('productsPerPageSelect').value);
      productPage = 1;
      
      if (useServerPagination) {
        loadProductsFromServer();
      } else {
        totalProductPages = Math.ceil(filteredProducts.length / productsPerPage);
        renderProducts();
      }
    }

    function clearProductFilters() {
      document.getElementById('productSearch').value = '';
      document.getElementById('filterCategory').value = '';
      document.getElementById('filterDepartment').value = '';
      document.getElementById('filterStatus').value = '';
      productPage = 1;
      productSortField = 'name';
      productSortDirection = 'asc';
      document.querySelectorAll('[id^="sort-"]').forEach(el => el.textContent = '↕');
      
      if (useServerPagination) {
        loadProductsFromServer();
      } else {
        filterProducts();
      }
    }

    async function loadCategoriesForSelect() {
      try {
        const response = await fetch(API_BASE + '/api/admin/categories?password=' + encodeURIComponent(password));
        const data = await response.json();
        allCategories = data.categories || [];
        
        // Atualizar select do modal de produto
        const select = document.getElementById('productCategory');
        select.innerHTML = '<option value="">Selecione...</option>' +
          allCategories.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join('');
      } catch (error) {
        console.error('Error loading categories:', error);
      }
    }

    // Array para armazenar códigos de barras do produto atual
    let currentProductBarcodes = [];
    let currentQuickPromoType = null;
    let currentEditingProductId = null;

    function switchProductTab(tab) {
      document.querySelectorAll('.product-tab-btn').forEach(btn => {
        btn.classList.remove('border-blue-600', 'text-blue-600');
        btn.classList.add('border-transparent', 'text-gray-500');
      });
      document.querySelector('.product-tab-btn[data-tab="' + tab + '"]').classList.remove('border-transparent', 'text-gray-500');
      document.querySelector('.product-tab-btn[data-tab="' + tab + '"]').classList.add('border-blue-600', 'text-blue-600');
      
      document.querySelectorAll('.product-tab-content').forEach(content => content.classList.add('hidden'));
      document.getElementById('productTab-' + tab).classList.remove('hidden');
    }

    function openProductModal(product = null) {
      document.getElementById('productModalTitle').textContent = product ? 'Editar Produto' : 'Novo Produto';
      document.getElementById('productId').value = product ? product.id : '';
      document.getElementById('productName').value = product ? product.name : '';
      document.getElementById('productSku').value = product ? product.sku || '' : '';
      document.getElementById('productCategory').value = product ? product.category_id || '' : '';
      document.getElementById('productDepartment').value = product ? product.department || '' : '';
      document.getElementById('productPrice').value = product ? product.price : '';
      document.getElementById('productCost').value = product ? product.cost || '' : '';
      document.getElementById('productStock').value = product ? product.stock || '' : '';
      document.getElementById('productUnit').value = product ? product.unit || 'unit' : 'unit';
      document.getElementById('productActive').checked = product ? product.is_active !== false : true;
      document.getElementById('productRequiresScale').checked = product ? product.requires_scale : false;
      
      // Carregar códigos de barras
      currentProductBarcodes = [];
      if (product) {
        // Adicionar barcode principal
        if (product.barcode) {
          currentProductBarcodes.push({ barcode: product.barcode, isPrimary: true });
        }
        // Adicionar barcodes adicionais se existirem
        if (product.barcodes && Array.isArray(product.barcodes)) {
          product.barcodes.forEach(b => {
            if (b && b !== product.barcode) {
              const bc = typeof b === 'string' ? b : b.barcode;
              if (bc && !currentProductBarcodes.find(x => x.barcode === bc)) {
                currentProductBarcodes.push({ barcode: bc, isPrimary: false });
              }
            }
          });
        }
        // Adicionar all_barcodes se existirem
        if (product.all_barcodes && Array.isArray(product.all_barcodes)) {
          product.all_barcodes.forEach(b => {
            const bc = typeof b === 'string' ? b : b.barcode;
            if (bc && !currentProductBarcodes.find(x => x.barcode === bc)) {
              currentProductBarcodes.push({ barcode: bc, isPrimary: false });
            }
          });
        }
      }
      renderBarcodesList();
      
      // Carregar promoções do produto
      currentEditingProductId = product ? product.id : null;
      if (product) {
        loadProductPromotions(product.id);
      } else {
        // Limpar lista de promoções para novo produto
        document.getElementById('productPromosList').innerHTML = '<div class="text-center py-4 text-gray-400">Salve o produto primeiro para adicionar promoções</div>';
        document.getElementById('productPromosCount').textContent = '0 promoções';
      }
      
      // Resetar promoção rápida
      currentQuickPromoType = null;
      document.getElementById('quickPromoFields').classList.add('hidden');
      document.querySelectorAll('.quick-promo-btn').forEach(btn => {
        btn.classList.remove('border-blue-500', 'bg-blue-50', 'border-green-500', 'bg-green-50', 
                            'border-purple-500', 'bg-purple-50', 'border-orange-500', 'bg-orange-50');
      });
      
      // Resetar para aba de informações
      switchProductTab('info');
      document.getElementById('newBarcodeInput').value = '';
      
      document.getElementById('productModal').classList.remove('hidden');
      document.getElementById('productModal').classList.add('flex');
    }

    function renderBarcodesList() {
      const list = document.getElementById('barcodesList');
      const count = document.getElementById('barcodesCount');
      
      if (currentProductBarcodes.length === 0) {
        list.innerHTML = '<div class="text-center py-4 text-gray-400">Nenhum código de barras cadastrado</div>';
        count.textContent = '0 códigos de barras';
        return;
      }
      
      list.innerHTML = currentProductBarcodes.map((b, idx) => {
        return '<div class="flex items-center gap-2 p-2 bg-gray-50 rounded-lg ' + (b.isPrimary ? 'border-2 border-green-400' : 'border') + '">' +
          '<span class="font-mono text-sm flex-1 bg-white px-3 py-1 rounded">' + b.barcode + '</span>' +
          (b.isPrimary 
            ? '<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">Principal</span>' 
            : '<button type="button" onclick="setPrimaryBarcode(' + idx + ')" class="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded">Tornar Principal</button>') +
          '<button type="button" onclick="removeBarcode(' + idx + ')" class="p-1 text-red-500 hover:bg-red-50 rounded" title="Remover">🗑️</button>' +
        '</div>';
      }).join('');
      
      count.textContent = currentProductBarcodes.length + ' código' + (currentProductBarcodes.length !== 1 ? 's' : '') + ' de barras';
    }

    function addBarcode() {
      const input = document.getElementById('newBarcodeInput');
      const barcode = input.value.trim();
      
      if (!barcode) {
        alert('Digite um código de barras');
        return;
      }
      
      if (currentProductBarcodes.find(b => b.barcode === barcode)) {
        alert('Este código de barras já foi adicionado');
        input.value = '';
        return;
      }
      
      // Se é o primeiro, é o principal
      const isPrimary = currentProductBarcodes.length === 0;
      currentProductBarcodes.push({ barcode, isPrimary });
      
      input.value = '';
      input.focus();
      renderBarcodesList();
    }

    function removeBarcode(index) {
      const removed = currentProductBarcodes[index];
      currentProductBarcodes.splice(index, 1);
      
      // Se removeu o principal e ainda tem outros, o primeiro vira principal
      if (removed.isPrimary && currentProductBarcodes.length > 0) {
        currentProductBarcodes[0].isPrimary = true;
      }
      
      renderBarcodesList();
    }

    function setPrimaryBarcode(index) {
      currentProductBarcodes.forEach((b, i) => {
        b.isPrimary = (i === index);
      });
      // Mover para o início
      const [primary] = currentProductBarcodes.splice(index, 1);
      currentProductBarcodes.unshift(primary);
      renderBarcodesList();
    }

    // =====================
    // PROMOÇÕES DENTRO DO PRODUTO
    // =====================

    function loadProductPromotions(productId) {
      currentEditingProductId = productId;
      const product = allProducts.find(p => p.id === productId);
      if (!product) return;
      
      // Filtrar promoções para este produto
      const productPromos = allPromotions.filter(p => 
        p.product_barcode === product.barcode || 
        p.product_id === productId ||
        (p.mix_match_products && p.mix_match_products.includes(product.barcode))
      );
      
      const list = document.getElementById('productPromosList');
      const count = document.getElementById('productPromosCount');
      
      count.textContent = productPromos.length + ' promoção' + (productPromos.length !== 1 ? 'ões' : '');
      
      if (productPromos.length === 0) {
        list.innerHTML = '<div class="text-center py-4 text-gray-400">Nenhuma promoção ativa para este produto</div>';
        return;
      }
      
      list.innerHTML = productPromos.map(p => {
        const typeConfig = {
          'fixed_price': { icon: '💲', color: 'blue', label: 'Preço Fixo' },
          'multi_buy': { icon: '📦', color: 'green', label: 'Leve X por $Y' },
          'buy_get': { icon: '🎁', color: 'purple', label: 'Compre X Leve Y' },
          'percent_off': { icon: '📊', color: 'orange', label: 'Desconto %' },
          'mix_match': { icon: '🎨', color: 'pink', label: 'Mix & Match' }
        };
        const config = typeConfig[p.promo_type] || typeConfig['fixed_price'];
        
        let details = '';
        if (p.promo_type === 'fixed_price') {
          details = 'Por $' + (p.promotional_price || p.price || 0).toFixed(2);
        } else if (p.promo_type === 'multi_buy') {
          details = 'Leve ' + (p.multi_buy_qty || 2) + ' por $' + (p.multi_buy_price || 0).toFixed(2);
        } else if (p.promo_type === 'buy_get') {
          details = 'Compre ' + (p.buy_qty || 2) + ' leve ' + (p.get_qty || 3);
        } else if (p.promo_type === 'percent_off') {
          details = (p.percent_off || 20) + '% de desconto';
        } else if (p.promo_type === 'mix_match') {
          details = 'Escolha ' + (p.mix_match_qty || 3) + ' por $' + (p.mix_match_price || 0).toFixed(2);
        }
        
        return '<div class="flex items-center justify-between p-3 bg-' + config.color + '-50 border border-' + config.color + '-200 rounded-lg">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-lg">' + config.icon + '</span>' +
            '<div>' +
              '<p class="font-medium text-gray-800">' + (p.name || 'Promoção') + '</p>' +
              '<p class="text-xs text-' + config.color + '-600">' + details + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<button type="button" onclick="editPromotionFromProduct(' + p.id + ')" class="p-1 text-blue-600 hover:bg-blue-100 rounded" title="Editar">✏️</button>' +
            '<button type="button" onclick="deletePromotionFromProduct(' + p.id + ')" class="p-1 text-red-600 hover:bg-red-100 rounded" title="Excluir">🗑️</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function editPromotionFromProduct(promoId) {
      const promotion = allPromotions.find(p => p.id === promoId);
      if (promotion) {
        closeProductModal();
        setTimeout(() => openPromotionModal(promotion), 100);
      }
    }

    async function deletePromotionFromProduct(promoId) {
      if (!confirm('Tem certeza que deseja excluir esta promoção?')) return;
      
      try {
        const response = await fetch('/api/admin/promotions/' + promoId + '?password=' + encodeURIComponent(password), {
          method: 'DELETE',
          headers: { 'X-Owner-Password': password }
        });
        
        if (response.ok) {
          allPromotions = allPromotions.filter(p => p.id !== promoId);
          loadProductPromotions(currentEditingProductId);
          showToast('Promoção excluída!', 'success');
        }
      } catch (error) {
        showToast('Erro ao excluir promoção', 'error');
      }
    }

    function selectQuickPromoType(type) {
      currentQuickPromoType = type;
      
      // Mostrar campos
      document.getElementById('quickPromoFields').classList.remove('hidden');
      
      // Esconder todos os campos específicos
      document.querySelectorAll('.quick-promo-field').forEach(el => el.classList.add('hidden'));
      
      // Resetar botões
      document.querySelectorAll('.quick-promo-btn').forEach(btn => {
        btn.classList.remove('border-blue-500', 'bg-blue-50', 'border-green-500', 'bg-green-50', 
                            'border-purple-500', 'bg-purple-50', 'border-orange-500', 'bg-orange-50');
      });
      
      // Mostrar campo e destacar botão
      const colors = {
        'fixed_price': { field: 'quickPromoFixed', colors: ['border-blue-500', 'bg-blue-50'] },
        'multi_buy': { field: 'quickPromoMultiBuy', colors: ['border-green-500', 'bg-green-50'] },
        'buy_get': { field: 'quickPromoBuyGet', colors: ['border-purple-500', 'bg-purple-50'] },
        'percent_off': { field: 'quickPromoPercent', colors: ['border-orange-500', 'bg-orange-50'] }
      };
      
      const config = colors[type];
      if (config) {
        document.getElementById(config.field).classList.remove('hidden');
        const btn = document.querySelector('.quick-promo-btn[data-type="' + type + '"]');
        if (btn) btn.classList.add(...config.colors);
      }
      
      // Atualizar informações baseadas no preço do produto
      updateQuickPromoInfo();
    }

    function updateQuickPromoInfo() {
      const productPrice = parseFloat(document.getElementById('productPrice').value) || 0;
      
      // Preço fixo - mostrar economia
      const promoPrice = parseFloat(document.getElementById('quickPromoPrice')?.value) || 0;
      if (promoPrice > 0 && productPrice > 0) {
        const savings = productPrice - promoPrice;
        const savingsPercent = ((savings / productPrice) * 100).toFixed(0);
        document.getElementById('quickPromoSavings').textContent = 
          'Economia de $' + savings.toFixed(2) + ' (' + savingsPercent + '% off)';
      }
      
      // Multi-buy
      const multiQty = parseInt(document.getElementById('quickPromoQty')?.value) || 2;
      const multiPrice = parseFloat(document.getElementById('quickPromoMultiPrice')?.value) || 0;
      if (multiPrice > 0 && productPrice > 0) {
        const originalTotal = multiQty * productPrice;
        const savings = originalTotal - multiPrice;
        document.getElementById('quickPromoMultiSavings').textContent = 
          'De $' + originalTotal.toFixed(2) + ' por $' + multiPrice.toFixed(2) + ' (economia de $' + savings.toFixed(2) + ')';
      }
      
      // Buy Get
      const buyQty = parseInt(document.getElementById('quickPromoBuy')?.value) || 2;
      const getQty = parseInt(document.getElementById('quickPromoGet')?.value) || 3;
      const freeQty = getQty - buyQty;
      document.getElementById('quickPromoBuyGetInfo').textContent = 
        'Cliente paga ' + buyQty + ', leva ' + getQty + ' (' + freeQty + ' grátis!)';
      
      // Percent
      const percent = parseInt(document.getElementById('quickPromoPercentValue')?.value) || 20;
      if (productPrice > 0) {
        const finalPrice = productPrice * (1 - percent / 100);
        document.getElementById('quickPromoPercentInfo').textContent = 
          'De $' + productPrice.toFixed(2) + ' por $' + finalPrice.toFixed(2);
      }
    }

    async function saveQuickPromo() {
      if (!currentQuickPromoType || !currentEditingProductId) {
        showToast('Selecione um tipo de promoção', 'error');
        return;
      }
      
      const product = allProducts.find(p => p.id === currentEditingProductId);
      if (!product) return;
      
      const promotion = {
        name: product.name + ' - Promoção',
        product_barcode: product.barcode || product.id,
        product_id: product.id,
        promo_type: currentQuickPromoType,
        start_date: document.getElementById('quickPromoStart').value || null,
        end_date: document.getElementById('quickPromoEnd').value || null,
        is_active: true
      };
      
      // Preencher campos específicos
      if (currentQuickPromoType === 'fixed_price') {
        promotion.promotional_price = parseFloat(document.getElementById('quickPromoPrice').value) || 0;
        promotion.regular_price = product.price;
        promotion.price = promotion.promotional_price;
        if (!promotion.promotional_price) {
          showToast('Informe o preço promocional', 'error');
          return;
        }
      } else if (currentQuickPromoType === 'multi_buy') {
        promotion.multi_buy_qty = parseInt(document.getElementById('quickPromoQty').value) || 2;
        promotion.multi_buy_price = parseFloat(document.getElementById('quickPromoMultiPrice').value) || 0;
        if (!promotion.multi_buy_price) {
          showToast('Informe o valor da promoção', 'error');
          return;
        }
      } else if (currentQuickPromoType === 'buy_get') {
        promotion.buy_qty = parseInt(document.getElementById('quickPromoBuy').value) || 2;
        promotion.get_qty = parseInt(document.getElementById('quickPromoGet').value) || 3;
      } else if (currentQuickPromoType === 'percent_off') {
        promotion.percent_off = parseInt(document.getElementById('quickPromoPercentValue').value) || 20;
      }
      
      try {
        const response = await fetch('/api/admin/promotions?password=' + encodeURIComponent(password), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Owner-Password': password
          },
          body: JSON.stringify(promotion)
        });
        
        if (response.ok) {
          const saved = await response.json();
          if (saved.promotion) {
            allPromotions.push(saved.promotion);
          } else {
            allPromotions.push(saved);
          }
          showToast('Promoção criada com sucesso!', 'success');
          
          // Resetar campos
          currentQuickPromoType = null;
          document.getElementById('quickPromoFields').classList.add('hidden');
          document.querySelectorAll('.quick-promo-btn').forEach(btn => {
            btn.classList.remove('border-blue-500', 'bg-blue-50', 'border-green-500', 'bg-green-50', 
                                'border-purple-500', 'bg-purple-50', 'border-orange-500', 'bg-orange-50');
          });
          
          // Recarregar lista de promoções
          loadProductPromotions(currentEditingProductId);
        } else {
          showToast('Erro ao criar promoção', 'error');
        }
      } catch (error) {
        showToast('Erro ao criar promoção', 'error');
      }
    }

    // Event listeners para atualizar info de promoção rápida
    document.addEventListener('DOMContentLoaded', function() {
      ['quickPromoPrice', 'quickPromoQty', 'quickPromoMultiPrice', 'quickPromoBuy', 'quickPromoGet', 'quickPromoPercentValue'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateQuickPromoInfo);
      });
    });

    function closeProductModal() {
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
      currentProductBarcodes = [];
    }

    function editProduct(id) {
      const product = allProducts.find(p => p.id === id) || filteredProducts.find(p => p.id === id);
      if (product) openProductModal(product);
    }

    async function saveProduct(e) {
      e.preventDefault();
      
      // Pegar o barcode principal (primeiro da lista)
      const primaryBarcode = currentProductBarcodes.find(b => b.isPrimary)?.barcode || 
                            currentProductBarcodes[0]?.barcode || null;
      
      // Todos os barcodes adicionais
      const allBarcodes = currentProductBarcodes.map(b => b.barcode);
      
      const product = {
        id: document.getElementById('productId').value ? parseInt(document.getElementById('productId').value) : null,
        name: document.getElementById('productName').value,
        barcode: primaryBarcode,
        barcodes: allBarcodes,
        all_barcodes: allBarcodes,
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
        
        // Determinar tipo e cor
        const promoType = p.promo_type || 'fixed_price';
        const typeConfig = {
          'fixed_price': { icon: '💲', color: 'blue', label: 'Preço Fixo' },
          'multi_buy': { icon: '📦', color: 'green', label: 'Leve X por $Y' },
          'buy_get': { icon: '🎁', color: 'purple', label: 'Compre X Leve Y' },
          'percent_off': { icon: '📊', color: 'orange', label: 'Desconto %' },
          'mix_match': { icon: '🎨', color: 'pink', label: 'Mix and Match' }
        };
        const config = typeConfig[promoType] || typeConfig['fixed_price'];
        
        // Gerar conteúdo específico do tipo
        let promoContent = '';
        if (promoType === 'fixed_price') {
          promoContent = (p.regular_price ? '<p class="text-sm text-gray-500 line-through">De: $' + p.regular_price.toFixed(2) + '</p>' : '') +
            '<p class="text-2xl font-bold text-green-600">$' + (p.promotional_price || p.price || 0).toFixed(2) + '</p>';
        } else if (promoType === 'multi_buy') {
          promoContent = '<div class="bg-green-100 rounded-lg p-2 text-center">' +
            '<p class="text-lg font-bold text-green-700">Leve ' + (p.multi_buy_qty || 2) + '</p>' +
            '<p class="text-2xl font-bold text-green-600">por $' + (p.multi_buy_price || 0).toFixed(2) + '</p>' +
            '<p class="text-xs text-green-600">($' + ((p.multi_buy_price || 0) / (p.multi_buy_qty || 2)).toFixed(2) + ' cada)</p>' +
          '</div>';
        } else if (promoType === 'buy_get') {
          promoContent = '<div class="bg-purple-100 rounded-lg p-2 text-center">' +
            '<p class="text-lg font-bold text-purple-700">Compre ' + (p.buy_qty || 2) + '</p>' +
            '<p class="text-2xl font-bold text-purple-600">Leve ' + (p.get_qty || 3) + '</p>' +
            '<p class="text-xs text-purple-600">(' + ((p.get_qty || 3) - (p.buy_qty || 2)) + ' GRÁTIS!)</p>' +
          '</div>';
        } else if (promoType === 'percent_off') {
          promoContent = '<div class="bg-orange-100 rounded-lg p-2 text-center">' +
            '<p class="text-3xl font-bold text-orange-600">' + (p.percent_off || 20) + '%</p>' +
            '<p class="text-sm text-orange-700">de desconto</p>' +
          '</div>';
        } else if (promoType === 'mix_match') {
          const productCount = (p.mix_match_products || []).length;
          promoContent = '<div class="bg-pink-100 rounded-lg p-2 text-center">' +
            '<p class="text-lg font-bold text-pink-700">Escolha ' + (p.mix_match_qty || 3) + '</p>' +
            '<p class="text-2xl font-bold text-pink-600">por $' + (p.mix_match_price || 0).toFixed(2) + '</p>' +
            (p.mix_match_group ? '<p class="text-xs text-pink-600">' + p.mix_match_group + '</p>' : '') +
            (productCount > 0 ? '<p class="text-xs text-pink-500 mt-1">' + productCount + ' produtos elegíveis</p>' : '') +
          '</div>';
        }
        
        const bgGradient = isActive && isInPeriod 
          ? 'from-' + config.color + '-50 to-' + config.color + '-100 border-' + config.color + '-300'
          : 'from-gray-50 to-gray-100 border-gray-300';
        
        return '<div class="bg-gradient-to-br ' + bgGradient + ' rounded-xl p-4 border-2">' +
          '<div class="flex justify-between items-start mb-3">' +
            '<div>' +
              '<div class="flex items-center gap-2 mb-1">' +
                '<span class="text-xl">' + config.icon + '</span>' +
                '<span class="text-xs px-2 py-0.5 bg-' + config.color + '-200 text-' + config.color + '-800 rounded-full">' + config.label + '</span>' +
              '</div>' +
              '<h4 class="font-bold text-gray-800">' + (p.name || 'Promoção') + '</h4>' +
            '</div>' +
            '<div class="flex gap-1">' +
              '<button onclick="editPromotion(' + p.id + ')" class="p-1 hover:bg-white/50 rounded">✏️</button>' +
              '<button onclick="deletePromotion(' + p.id + ')" class="p-1 hover:bg-red-100 rounded">🗑️</button>' +
            '</div>' +
          '</div>' +
          '<div class="space-y-2">' +
            promoContent +
            (p.start_date || p.end_date ? '<p class="text-xs text-gray-500 text-center mt-2">' + 
              (p.start_date ? new Date(p.start_date).toLocaleDateString('pt-BR') : '...') + 
              ' até ' + 
              (p.end_date ? new Date(p.end_date).toLocaleDateString('pt-BR') : '...') + 
            '</p>' : '') +
            '<div class="text-center mt-2">' +
              '<span class="inline-block px-3 py-1 rounded-full text-xs font-medium ' + (isActive && isInPeriod ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-700') + '">' +
                (isActive && isInPeriod ? '✓ Ativa' : 'Inativa') +
              '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    let currentPromoType = 'fixed_price';
    let selectedPromoProducts = []; // Produtos selecionados para Mix & Match
    let selectedSingleProduct = null; // Produto selecionado para promoções simples
    let promoSearchTimeout = null;

    function selectPromoType(type) {
      currentPromoType = type;
      
      // Esconder todos os campos
      document.querySelectorAll('.promo-fields').forEach(el => el.classList.add('hidden'));
      
      // Mostrar/esconder seção de produto único vs mix & match
      const singleProductSection = document.getElementById('productSelectorSection');
      if (type === 'mix_match') {
        singleProductSection?.classList.add('hidden');
      } else {
        singleProductSection?.classList.remove('hidden');
      }
      
      // Mostrar os campos do tipo selecionado
      if (type === 'fixed_price') {
        document.getElementById('fixedPriceFields').classList.remove('hidden');
      } else if (type === 'multi_buy') {
        document.getElementById('multiBuyFields').classList.remove('hidden');
        updateMultiBuyPreview();
      } else if (type === 'buy_get') {
        document.getElementById('buyGetFields').classList.remove('hidden');
        updateBuyGetPreview();
      } else if (type === 'percent_off') {
        document.getElementById('percentOffFields').classList.remove('hidden');
      } else if (type === 'mix_match') {
        document.getElementById('mixMatchFields').classList.remove('hidden');
        updateMixMatchPreview();
      }
      
      // Atualizar visual dos radio buttons
      document.querySelectorAll('.promo-type-option').forEach(el => {
        el.classList.remove('border-blue-500', 'bg-blue-50', 'border-green-500', 'bg-green-50', 'border-purple-500', 'bg-purple-50', 'border-orange-500', 'bg-orange-50', 'border-pink-500', 'bg-pink-50');
      });
      
      const selected = document.querySelector('input[name="promoType"][value="' + type + '"]');
      if (selected) {
        selected.checked = true;
        const colors = {
          'fixed_price': ['border-blue-500', 'bg-blue-50'],
          'multi_buy': ['border-green-500', 'bg-green-50'],
          'buy_get': ['border-purple-500', 'bg-purple-50'],
          'percent_off': ['border-orange-500', 'bg-orange-50'],
          'mix_match': ['border-pink-500', 'bg-pink-50']
        };
        selected.closest('.promo-type-option').classList.add(...colors[type]);
      }
    }

    function updateMultiBuyPreview() {
      const qty = parseInt(document.getElementById('multiBuyQty').value) || 2;
      const price = parseFloat(document.getElementById('multiBuyPrice').value) || 0;
      const unitPrice = price > 0 ? (price / qty).toFixed(2) : '0.00';
      document.getElementById('multiBuyPreview').textContent = 'Preço unitário na promoção: $' + unitPrice;
    }

    function updateBuyGetPreview() {
      const buy = parseInt(document.getElementById('buyGetBuy').value) || 2;
      const get = parseInt(document.getElementById('buyGetGet').value) || 3;
      const free = get - buy;
      document.getElementById('buyGetPreview').textContent = 'Cliente paga ' + buy + ', leva ' + get + ' (' + free + ' grátis!)';
    }

    function updateMixMatchPreview() {
      const qty = parseInt(document.getElementById('mixMatchQty').value) || 3;
      const price = parseFloat(document.getElementById('mixMatchPrice').value) || 0;
      const group = document.getElementById('mixMatchGroup').value || 'do grupo';
      document.getElementById('mixMatchPreview').textContent = 'Escolha ' + qty + ' itens ' + group + ' e pague apenas $' + price.toFixed(2) + '!';
    }

    // =====================
    // BUSCA DE PRODUTOS PARA PROMOÇÕES
    // =====================
    
    function searchProductsForPromo(query) {
      clearTimeout(promoSearchTimeout);
      const resultsDiv = document.getElementById('promoProductResults');
      
      if (!query || query.length < 2) {
        resultsDiv.classList.add('hidden');
        return;
      }
      
      promoSearchTimeout = setTimeout(() => {
        const searchLower = query.toLowerCase();
        const results = allProducts.filter(p => 
          (p.name && p.name.toLowerCase().includes(searchLower)) ||
          (p.barcode && p.barcode.includes(query)) ||
          (p.sku && p.sku.includes(query))
        ).slice(0, 10); // Limitar a 10 resultados
        
        if (results.length === 0) {
          resultsDiv.innerHTML = '<div class="p-4 text-center text-gray-400">Nenhum produto encontrado</div>';
        } else {
          resultsDiv.innerHTML = results.map(p => {
            const isSelected = selectedPromoProducts.some(sp => sp.id === p.id);
            return '<div class="flex items-center justify-between p-3 hover:bg-pink-50 cursor-pointer border-b last:border-b-0 ' + (isSelected ? 'bg-green-50' : '') + '" onclick="togglePromoProduct(' + p.id + ')">' +
              '<div class="flex-1">' +
                '<p class="font-medium text-gray-800 truncate">' + (p.name || 'Sem nome') + '</p>' +
                '<p class="text-xs text-gray-500 font-mono">' + (p.barcode || p.sku || p.id) + '</p>' +
              '</div>' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-green-600 font-bold">$' + (p.price || 0).toFixed(2) + '</span>' +
                (isSelected 
                  ? '<span class="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-sm">✓</span>'
                  : '<span class="w-6 h-6 bg-gray-200 text-gray-400 rounded-full flex items-center justify-center text-sm">+</span>') +
              '</div>' +
            '</div>';
          }).join('');
        }
        
        resultsDiv.classList.remove('hidden');
      }, 300);
    }

    function showPromoProductResults() {
      const query = document.getElementById('promoProductSearch').value;
      if (query && query.length >= 2) {
        document.getElementById('promoProductResults').classList.remove('hidden');
      }
    }

    function togglePromoProduct(productId) {
      const product = allProducts.find(p => p.id === productId);
      if (!product) return;
      
      const existingIndex = selectedPromoProducts.findIndex(p => p.id === productId);
      
      if (existingIndex >= 0) {
        // Remover
        selectedPromoProducts.splice(existingIndex, 1);
      } else {
        // Adicionar
        selectedPromoProducts.push({
          id: product.id,
          name: product.name,
          barcode: product.barcode,
          sku: product.sku,
          price: product.price
        });
      }
      
      renderSelectedProducts();
      // Re-buscar para atualizar os checkmarks
      searchProductsForPromo(document.getElementById('promoProductSearch').value);
    }

    function removePromoProduct(productId) {
      selectedPromoProducts = selectedPromoProducts.filter(p => p.id !== productId);
      renderSelectedProducts();
    }

    function renderSelectedProducts() {
      const listDiv = document.getElementById('selectedProductsList');
      const countSpan = document.getElementById('selectedProductsCount');
      
      countSpan.textContent = selectedPromoProducts.length + ' produto' + (selectedPromoProducts.length !== 1 ? 's' : '');
      
      if (selectedPromoProducts.length === 0) {
        listDiv.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">Nenhum produto adicionado</p>';
        return;
      }
      
      listDiv.innerHTML = '<div class="flex flex-wrap gap-2">' + 
        selectedPromoProducts.map(p => 
          '<div class="inline-flex items-center gap-2 bg-white border border-pink-300 rounded-full pl-3 pr-1 py-1 shadow-sm">' +
            '<div class="max-w-[150px]">' +
              '<p class="text-sm font-medium text-gray-800 truncate">' + (p.name || 'Produto') + '</p>' +
              '<p class="text-xs text-gray-500 font-mono">' + (p.barcode || p.sku || p.id) + '</p>' +
            '</div>' +
            '<button type="button" onclick="removePromoProduct(' + p.id + ')" class="w-6 h-6 bg-red-100 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center text-xs font-bold">×</button>' +
          '</div>'
        ).join('') +
      '</div>';
    }

    // Busca para produto único (Multi-buy, Preço fixo, etc)
    function searchSingleProduct(query) {
      clearTimeout(promoSearchTimeout);
      const resultsDiv = document.getElementById('singleProductResults');
      
      if (!query || query.length < 2) {
        resultsDiv.classList.add('hidden');
        return;
      }
      
      promoSearchTimeout = setTimeout(() => {
        const searchLower = query.toLowerCase();
        const results = allProducts.filter(p => 
          (p.name && p.name.toLowerCase().includes(searchLower)) ||
          (p.barcode && p.barcode.includes(query)) ||
          (p.sku && p.sku.includes(query))
        ).slice(0, 8);
        
        if (results.length === 0) {
          resultsDiv.innerHTML = '<div class="p-4 text-center text-gray-400">Nenhum produto encontrado</div>';
        } else {
          resultsDiv.innerHTML = results.map(p => 
            '<div class="flex items-center justify-between p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0" onclick="selectSingleProduct(' + p.id + ')">' +
              '<div class="flex-1">' +
                '<p class="font-medium text-gray-800 truncate">' + (p.name || 'Sem nome') + '</p>' +
                '<p class="text-xs text-gray-500 font-mono">' + (p.barcode || p.sku || p.id) + '</p>' +
              '</div>' +
              '<span class="text-green-600 font-bold">$' + (p.price || 0).toFixed(2) + '</span>' +
            '</div>'
          ).join('');
        }
        
        resultsDiv.classList.remove('hidden');
      }, 300);
    }

    function showSingleProductResults() {
      const query = document.getElementById('singleProductSearch').value;
      if (query && query.length >= 2) {
        document.getElementById('singleProductResults').classList.remove('hidden');
      }
    }

    function selectSingleProduct(productId) {
      const product = allProducts.find(p => p.id === productId);
      if (!product) return;
      
      selectedSingleProduct = product;
      document.getElementById('promotionProduct').value = product.barcode || product.id;
      document.getElementById('promotionRegularPrice').value = product.price || '';
      
      // Mostrar produto selecionado
      const selectedDiv = document.getElementById('selectedSingleProduct');
      selectedDiv.innerHTML = 
        '<div class="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">' +
          '<div class="flex-1">' +
            '<p class="font-medium text-gray-800">' + product.name + '</p>' +
            '<p class="text-xs text-gray-500 font-mono">' + (product.barcode || product.sku || product.id) + '</p>' +
          '</div>' +
          '<div class="flex items-center gap-3">' +
            '<span class="text-green-600 font-bold text-lg">$' + (product.price || 0).toFixed(2) + '</span>' +
            '<button type="button" onclick="clearSingleProduct()" class="p-1 bg-red-100 hover:bg-red-200 text-red-600 rounded-full">✕</button>' +
          '</div>' +
        '</div>';
      selectedDiv.classList.remove('hidden');
      
      // Esconder resultados e limpar busca
      document.getElementById('singleProductResults').classList.add('hidden');
      document.getElementById('singleProductSearch').value = '';
    }

    function clearSingleProduct() {
      selectedSingleProduct = null;
      document.getElementById('promotionProduct').value = '';
      document.getElementById('selectedSingleProduct').classList.add('hidden');
      document.getElementById('selectedSingleProduct').innerHTML = '';
    }

    // Fechar dropdowns ao clicar fora
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#promoProductSearch') && !e.target.closest('#promoProductResults')) {
        document.getElementById('promoProductResults')?.classList.add('hidden');
      }
      if (!e.target.closest('#singleProductSearch') && !e.target.closest('#singleProductResults')) {
        document.getElementById('singleProductResults')?.classList.add('hidden');
      }
    });

    // Event listeners para preview
    document.addEventListener('DOMContentLoaded', function() {
      const multiBuyQty = document.getElementById('multiBuyQty');
      const multiBuyPrice = document.getElementById('multiBuyPrice');
      const buyGetBuy = document.getElementById('buyGetBuy');
      const buyGetGet = document.getElementById('buyGetGet');
      const mixMatchQty = document.getElementById('mixMatchQty');
      const mixMatchPrice = document.getElementById('mixMatchPrice');
      const mixMatchGroup = document.getElementById('mixMatchGroup');
      
      if (multiBuyQty) multiBuyQty.addEventListener('input', updateMultiBuyPreview);
      if (multiBuyPrice) multiBuyPrice.addEventListener('input', updateMultiBuyPreview);
      if (buyGetBuy) buyGetBuy.addEventListener('input', updateBuyGetPreview);
      if (buyGetGet) buyGetGet.addEventListener('input', updateBuyGetPreview);
      if (mixMatchQty) mixMatchQty.addEventListener('input', updateMixMatchPreview);
      if (mixMatchPrice) mixMatchPrice.addEventListener('input', updateMixMatchPreview);
      if (mixMatchGroup) mixMatchGroup.addEventListener('input', updateMixMatchPreview);
    });

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
      
      // Limpar seleções anteriores
      if (!promotion) {
        selectedPromoProducts = [];
        selectedSingleProduct = null;
        renderSelectedProducts();
        document.getElementById('selectedSingleProduct').innerHTML = '';
        document.getElementById('selectedSingleProduct').classList.add('hidden');
        document.getElementById('promoProductSearch').value = '';
        document.getElementById('singleProductSearch').value = '';
      }
      
      // Carregar tipo de promoção
      const promoType = promotion?.promo_type || 'fixed_price';
      selectPromoType(promoType);
      
      // Preencher campos específicos
      if (promoType === 'multi_buy' && promotion) {
        document.getElementById('multiBuyQty').value = promotion.multi_buy_qty || 2;
        document.getElementById('multiBuyPrice').value = promotion.multi_buy_price || '';
        updateMultiBuyPreview();
      } else if (promoType === 'buy_get' && promotion) {
        document.getElementById('buyGetBuy').value = promotion.buy_qty || 2;
        document.getElementById('buyGetGet').value = promotion.get_qty || 3;
        updateBuyGetPreview();
      } else if (promoType === 'percent_off' && promotion) {
        document.getElementById('percentOffValue').value = promotion.percent_off || 20;
      } else if (promoType === 'mix_match' && promotion) {
        document.getElementById('mixMatchQty').value = promotion.mix_match_qty || 3;
        document.getElementById('mixMatchPrice').value = promotion.mix_match_price || '';
        document.getElementById('mixMatchGroup').value = promotion.mix_match_group || '';
        // Carregar produtos selecionados do Mix & Match
        selectedPromoProducts = [];
        if (promotion.mix_match_products && promotion.mix_match_products.length > 0) {
          promotion.mix_match_products.forEach(barcode => {
            const product = allProducts.find(p => p.barcode === barcode || p.id == barcode);
            if (product) {
              selectedPromoProducts.push({
                id: product.id,
                name: product.name,
                barcode: product.barcode,
                sku: product.sku,
                price: product.price
              });
            }
          });
        }
        renderSelectedProducts();
        updateMixMatchPreview();
      }
      
      // Carregar produto único para outros tipos de promoção
      clearSingleProduct();
      if (['fixed_price', 'multi_buy', 'buy_get', 'percent_off'].includes(promoType) && promotion && promotion.product_barcode) {
        const product = allProducts.find(p => p.barcode === promotion.product_barcode || p.id == promotion.product_barcode);
        if (product) {
          selectSingleProduct(product.id);
        }
      }
      
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
      
      const promoType = currentPromoType;
      
      const promotion = {
        id: document.getElementById('promotionId').value ? parseInt(document.getElementById('promotionId').value) : null,
        name: document.getElementById('promotionName').value,
        product_id: document.getElementById('promotionProduct').value || null,
        promo_type: promoType,
        start_date: document.getElementById('promotionStartDate').value || null,
        end_date: document.getElementById('promotionEndDate').value || null,
        is_active: document.getElementById('promotionActive').checked
      };
      
      // Adicionar campos específicos do tipo
      if (promoType === 'fixed_price') {
        promotion.regular_price = parseFloat(document.getElementById('promotionRegularPrice').value) || null;
        promotion.promotional_price = parseFloat(document.getElementById('promotionPrice').value) || 0;
        promotion.price = promotion.promotional_price;
      } else if (promoType === 'multi_buy') {
        promotion.multi_buy_qty = parseInt(document.getElementById('multiBuyQty').value) || 2;
        promotion.multi_buy_price = parseFloat(document.getElementById('multiBuyPrice').value) || 0;
        promotion.promotional_price = promotion.multi_buy_price / promotion.multi_buy_qty;
        promotion.price = promotion.promotional_price;
      } else if (promoType === 'buy_get') {
        promotion.buy_qty = parseInt(document.getElementById('buyGetBuy').value) || 2;
        promotion.get_qty = parseInt(document.getElementById('buyGetGet').value) || 3;
      } else if (promoType === 'percent_off') {
        promotion.percent_off = parseInt(document.getElementById('percentOffValue').value) || 20;
      } else if (promoType === 'mix_match') {
        promotion.mix_match_qty = parseInt(document.getElementById('mixMatchQty').value) || 3;
        promotion.mix_match_price = parseFloat(document.getElementById('mixMatchPrice').value) || 0;
        promotion.mix_match_group = document.getElementById('mixMatchGroup').value || '';
        // Usar os produtos selecionados na interface
        promotion.mix_match_products = selectedPromoProducts.map(p => p.barcode || p.id);
      }

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


