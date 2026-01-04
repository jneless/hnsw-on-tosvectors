# HNSW & TOS Vectors 分层向量存储演示

HNSW（Hierarchical Navigable Small World）索引和 TOS Vector Bucket 的分层向量存储架构。

## 开发环境

本项目已配置为 Vercel 项目，支持使用 `vercel dev` 运行。

### 安装依赖

```bash
npm install
```

### 运行开发服务器

```bash
vercel dev --yes
```

服务器将在 http://localhost:3000 启动（如果端口被占用，会自动使用下一个可用端口）。

### 项目结构

- `public/` - 静态资源目录
  - `index.html` - 主页面
  - `app.js` - 应用逻辑（浏览器端 JavaScript）
  - `styles.css` - 样式文件
- `vercel.json` - Vercel 配置文件
- `package.json` - 项目配置（type: "module" 用于 CommonJS 兼容性）

### 注意事项

- 项目使用 ES Modules 配置（`"type": "module"`）以确保与 Vercel 的兼容性
- 所有静态文件都放在 `public/` 目录下
- `app.js` 是浏览器端代码，通过 `<script>` 标签加载，无需转换为 Node.js 模块
