// HNSW & TOS Vectors 分层向量存储演示
// 数据结构和全局变量

class Vector {
    constructor(id, data, timestamp, level = 0) {
        this.id = id;
        this.data = data; // 4维向量
        this.timestamp = timestamp;
        this.level = level; // 节点所在的最高层级
        this.neighbors = {}; // 每层的邻居节点 { layer: [neighbors] }

        // 初始化每一层的邻居数组
        for (let i = 0; i <= level; i++) {
            this.neighbors[i] = [];
        }
    }

    // 计算与另一个向量的欧氏距离
    distance(other) {
        let sum = 0;
        for (let i = 0; i < this.data.length; i++) {
            sum += Math.pow(this.data[i] - other.data[i], 2);
        }
        return Math.sqrt(sum);
    }
}

class HNSWIndex {
    constructor() {
        this.vectors = [];
        this.maxConnections = 2; // 每个节点最多连接数 (M) - 更稀疏
        this.maxConnectionsLayer0 = 4; // 第0层的最大连接数 (M0) - 更稀疏
        this.levelMultiplier = 1 / Math.log(2); // 层级分配参数 (mL)
        this.entryPoint = null; // 入口点（最高层的节点）
        this.maxLevel = 0; // 当前最高层级
    }

    // 随机分配层级（指数衰减分布）
    randomLevel() {
        let level = 0;
        while (Math.random() < 0.5 && level < 2) { // 最多2层（0,1,2 共3层）
            level++;
        }
        return level;
    }

    // 获取指定层级的最大连接数
    getMaxConnections(layer) {
        return layer === 0 ? this.maxConnectionsLayer0 : this.maxConnections;
    }

    // 插入向量到 HNSW 索引
    insert(vector) {
        // 第一个节点，直接设为入口点
        if (this.vectors.length === 0) {
            this.entryPoint = vector;
            this.maxLevel = vector.level;
            this.vectors.push(vector);
            return;
        }

        // 从顶层开始搜索最近邻
        let currentNearest = [{ vector: this.entryPoint, distance: vector.distance(this.entryPoint) }];

        // 从最高层向下搜索到新节点的层级+1
        for (let lc = this.maxLevel; lc > vector.level; lc--) {
            currentNearest = this.searchLayer(vector, currentNearest, 1, lc);
        }

        // 在新节点所在的每一层建立连接
        for (let lc = vector.level; lc >= 0; lc--) {
            const candidates = this.searchLayer(vector, currentNearest, this.getMaxConnections(lc), lc);
            const M = this.getMaxConnections(lc);

            // 选择最好的 M 个邻居
            const neighbors = this.selectNeighbors(vector, candidates, M);

            // 建立双向连接
            neighbors.forEach(neighbor => {
                this.addConnection(vector, neighbor.vector, lc);
                this.addConnection(neighbor.vector, vector, lc);

                // 如果邻居连接数超过限制，修剪连接
                const neighborConnections = neighbor.vector.neighbors[lc];
                if (neighborConnections.length > M) {
                    this.pruneConnections(neighbor.vector, M, lc);
                }
            });

            currentNearest = candidates;
        }

        this.vectors.push(vector);

        // 更新入口点
        if (vector.level > this.maxLevel) {
            this.maxLevel = vector.level;
            this.entryPoint = vector;
        }
    }

    // 在指定层搜索最近邻
    searchLayer(query, entryPoints, ef, layer) {
        const visited = new Set();
        const candidates = [...entryPoints];
        const results = [...entryPoints];

        // 初始化访问集合
        entryPoints.forEach(ep => visited.add(ep.vector.id));

        while (candidates.length > 0) {
            // 获取候选集中最近的点
            candidates.sort((a, b) => a.distance - b.distance);
            const current = candidates.shift();

            // 如果当前点比结果集中最远的点还远，停止搜索
            results.sort((a, b) => a.distance - b.distance);
            if (current.distance > results[results.length - 1].distance) {
                break;
            }

            // 检查当前点在该层的所有邻居
            const neighbors = current.vector.neighbors[layer] || [];
            neighbors.forEach(neighbor => {
                if (!visited.has(neighbor.id)) {
                    visited.add(neighbor.id);
                    const dist = query.distance(neighbor);

                    // 如果找到更近的点，或结果集未满
                    if (results.length < ef || dist < results[results.length - 1].distance) {
                        candidates.push({ vector: neighbor, distance: dist });
                        results.push({ vector: neighbor, distance: dist });

                        // 保持结果集大小
                        results.sort((a, b) => a.distance - b.distance);
                        if (results.length > ef) {
                            results.pop();
                        }
                    }
                }
            });
        }

        return results;
    }

    // 选择最佳邻居（启发式选择）
    selectNeighbors(query, candidates, M) {
        candidates.sort((a, b) => a.distance - b.distance);
        return candidates.slice(0, M);
    }

    // 添加连接
    addConnection(from, to, layer) {
        if (!from.neighbors[layer]) {
            from.neighbors[layer] = [];
        }
        if (!from.neighbors[layer].find(n => n.id === to.id)) {
            from.neighbors[layer].push(to);
        }
    }

    // 修剪连接（保留最近的 M 个）
    pruneConnections(vector, M, layer) {
        const neighbors = vector.neighbors[layer];
        if (neighbors.length <= M) return;

        const distances = neighbors.map(n => ({
            neighbor: n,
            distance: vector.distance(n)
        }));

        distances.sort((a, b) => a.distance - b.distance);
        vector.neighbors[layer] = distances.slice(0, M).map(d => d.neighbor);
    }

    // 查找 k 个最近邻（简化版，用于兼容）
    findKNearest(query, k) {
        if (this.vectors.length === 0) return [];

        const distances = this.vectors.map(v => ({
            vector: v,
            distance: query.distance(v)
        }));

        distances.sort((a, b) => a.distance - b.distance);
        return distances.slice(0, Math.min(k, distances.length)).map(d => d.vector);
    }

    // 搜索最近的向量，返回带距离的结果（使用分层搜索）
    search(query, k = 5, ef = 50) {
        if (this.vectors.length === 0) return [];
        if (!this.entryPoint) return [];

        // 从入口点开始
        let currentNearest = [{ vector: this.entryPoint, distance: query.distance(this.entryPoint) }];

        // 从最高层向下搜索到第1层
        for (let lc = this.maxLevel; lc > 0; lc--) {
            currentNearest = this.searchLayer(query, currentNearest, 1, lc);
        }

        // 在第0层进行详细搜索
        const results = this.searchLayer(query, currentNearest, Math.max(ef, k), 0);

        // 返回前 k 个结果
        results.sort((a, b) => a.distance - b.distance);
        return results.slice(0, k);
    }

    // 移除指定时间窗口及之前的向量（基于时间窗口）
    removeByTimeWindow(windowThreshold) {
        const removed = this.vectors.filter(v => {
            const vectorWindow = getTimeWindow(v.timestamp);
            return vectorWindow <= windowThreshold;
        });

        this.vectors = this.vectors.filter(v => {
            const vectorWindow = getTimeWindow(v.timestamp);
            return vectorWindow > windowThreshold;
        });

        // 清理邻居引用（所有层）
        const remainingIds = new Set(this.vectors.map(v => v.id));
        this.vectors.forEach(v => {
            for (let layer in v.neighbors) {
                v.neighbors[layer] = v.neighbors[layer].filter(n => remainingIds.has(n.id));
            }
        });

        // 如果入口点被移除，重新选择入口点
        if (this.entryPoint && !remainingIds.has(this.entryPoint.id)) {
            this.entryPoint = null;
            this.maxLevel = 0;

            // 找到层级最高的节点作为新入口点
            this.vectors.forEach(v => {
                if (v.level > this.maxLevel) {
                    this.maxLevel = v.level;
                    this.entryPoint = v;
                }
            });
        }

        return removed;
    }
}

class TOSVectorBucket {
    constructor() {
        this.indexes = []; // 存储多个时间戳索引
    }

    // 创建新的索引并写入向量（putVectors）- 基于时间窗口
    putVectors(vectors, windowStart) {
        const indexName = `index_${formatTimeWindow(windowStart).replace(/:/g, '-')}`;
        const index = {
            name: indexName,
            windowStart: windowStart,
            vectors: vectors,
            vectorCount: vectors.length
        };
        this.indexes.push(index);
        return index;
    }

    // 查询向量（queryVectors）- 基于时间窗口
    queryVectors(query, targetWindow, k = 5) {
        // 找到对应时间窗口的索引
        const targetIndex = this.indexes.find(idx => idx.windowStart === targetWindow);

        if (!targetIndex) {
            console.log(`未找到时间窗口 ${formatTimeWindow(targetWindow)} 的索引`);
            return [];
        }

        // 计算距离并返回最近的 k 个
        const distances = targetIndex.vectors.map(v => ({
            vector: v,
            distance: query.distance(v)
        }));

        distances.sort((a, b) => a.distance - b.distance);
        return distances.slice(0, k);
    }
}

// 全局应用状态
const app = {
    hnswIndex: new HNSWIndex(),
    tosBucket: new TOSVectorBucket(),
    vectorIdCounter: 0,
    startTime: Date.now(),
    flushInterval: 60000, // 每60秒检查一次（在整分钟时刻）
    retainWindowCount: 2, // 保留最近2个时间窗口
    svg: null,
    simulation: null,
    selectedNode: null,
    autoInsertTimer: null,
    nextInsertTime: null
};

// 工具函数
function generateRandomVector() {
    return Array.from({ length: 4 }, () => Math.random());
}

// 获取时间戳所属的时间窗口（分钟级别，左闭右开）
function getTimeWindow(timestamp) {
    const date = new Date(timestamp);
    date.setSeconds(0, 0); // 设置秒和毫秒为0
    return date.getTime();
}

// 为时间窗口生成颜色
function getColorForWindow(window, allWindows) {
    // 使用色相环生成不同的颜色，降低饱和度和亮度
    const sortedWindows = Array.from(allWindows).sort((a, b) => a - b);
    const index = sortedWindows.indexOf(window);
    const hue = (index * 137.5) % 360; // 使用黄金角度分布
    return `hsl(${hue}, 45%, 60%)`; // 降低饱和度到45%，提高亮度到60%
}

// 格式化时间窗口显示
function formatTimeWindow(windowStart) {
    const date = new Date(windowStart);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;

    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

function updateStats() {
    document.getElementById('hnswCount').textContent = app.hnswIndex.vectors.length;
    document.getElementById('tosIndexCount').textContent = app.tosBucket.indexes.length;

    const totalVectors = app.hnswIndex.vectors.length +
        app.tosBucket.indexes.reduce((sum, idx) => sum + idx.vectorCount, 0);
    document.getElementById('totalCount').textContent = totalVectors;

    // 更新按分钟统计
    updateMinuteStats();

    // 更新时间窗口选择器
    updateTimeWindowOptions();

    // 更新颜色图例
    updateWindowLegend();

    // 更新层级统计
    updateLayerStats();
}

// 按时间窗口统计 HNSW 中的向量
function updateMinuteStats() {
    const windowMap = new Map();

    // 按时间窗口分组
    app.hnswIndex.vectors.forEach(v => {
        const window = getTimeWindow(v.timestamp);
        windowMap.set(window, (windowMap.get(window) || 0) + 1);
    });

    const statsContainer = document.getElementById('hnswMinuteStats');
    if (windowMap.size === 0) {
        statsContainer.innerHTML = '<div style="padding: 8px;">暂无数据</div>';
        return;
    }

    // 按时间窗口排序（最新的在前）
    const sortedWindows = Array.from(windowMap.entries()).sort((a, b) => b[0] - a[0]);
    let html = '';
    sortedWindows.forEach(([window, count]) => {
        const timeLabel = formatTimeWindow(window);
        html += `<div style="padding: 6px 8px; margin-bottom: 4px; background-color: white; border-radius: 3px; border-left: 3px solid #0073bb;">
            <span style="color: #0073bb; font-weight: 700;">${timeLabel}:</span>
            <span style="color: #16191f; font-weight: 700;">${count}</span> 个向量
        </div>`;
    });

    statsContainer.innerHTML = html;
}

// 更新层级统计
function updateLayerStats() {
    const statsContainer = document.getElementById('hnswMinuteStats');
    if (!statsContainer) return;

    // 统计每层的节点数
    const layerMap = new Map();
    let maxLevel = 0;

    app.hnswIndex.vectors.forEach(v => {
        maxLevel = Math.max(maxLevel, v.level);
        for (let i = 0; i <= v.level; i++) {
            layerMap.set(i, (layerMap.get(i) || 0) + 1);
        }
    });

    if (app.hnswIndex.vectors.length === 0) {
        return;
    }

    // 添加层级统计到现有内容后面
    let layerHtml = '<div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #eaeded;">';
    layerHtml += '<h4 style="font-size: 13px; margin-bottom: 8px; color: #545b64;">HNSW 层级分布:</h4>';

    for (let i = maxLevel; i >= 0; i--) {
        const count = layerMap.get(i) || 0;
        layerHtml += `<div style="padding: 6px 8px; margin-bottom: 4px; background-color: white; border-radius: 3px; border-left: 3px solid #ff6b6b;">
            <span style="color: #ff6b6b; font-weight: 700;">层 ${i}:</span>
            <span style="color: #16191f; font-weight: 700;">${count}</span> 个节点
        </div>`;
    }
    layerHtml += '</div>';

    statsContainer.innerHTML += layerHtml;
}

// 更新时间窗口颜色图例
function updateWindowLegend() {
    const legendContainer = document.getElementById('windowLegend');
    if (!legendContainer) return;

    // 收集所有时间窗口
    const allWindows = new Set();
    app.hnswIndex.vectors.forEach(v => {
        allWindows.add(getTimeWindow(v.timestamp));
    });

    // 保留标题
    const title = legendContainer.querySelector('span');
    legendContainer.innerHTML = '';
    if (title) {
        legendContainer.appendChild(title);
    }

    if (allWindows.size === 0) {
        const emptyMsg = document.createElement('span');
        emptyMsg.style.fontSize = '12px';
        emptyMsg.style.color = '#687078';
        emptyMsg.textContent = '暂无数据';
        legendContainer.appendChild(emptyMsg);
        return;
    }

    // 按时间排序（最新的在前）
    const sortedWindows = Array.from(allWindows).sort((a, b) => b - a);
    sortedWindows.forEach(window => {
        const color = getColorForWindow(window, allWindows);
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '6px';

        const colorBox = document.createElement('div');
        colorBox.style.width = '16px';
        colorBox.style.height = '16px';
        colorBox.style.backgroundColor = color;
        colorBox.style.borderRadius = '3px';
        colorBox.style.border = '1px solid #d5dbdb';

        const label = document.createElement('span');
        label.style.fontSize = '12px';
        label.style.color = '#16191f';
        label.textContent = formatTimeWindow(window);

        item.appendChild(colorBox);
        item.appendChild(label);
        legendContainer.appendChild(item);
    });
}

// 更新时间窗口选择器选项
function updateTimeWindowOptions() {
    const selector = document.getElementById('timeWindow');
    const currentSelection = selector.value;

    // 收集所有可用的时间窗口
    const hnswWindows = new Set();
    app.hnswIndex.vectors.forEach(v => {
        hnswWindows.add(getTimeWindow(v.timestamp));
    });

    const tosWindows = new Set();
    app.tosBucket.indexes.forEach(idx => {
        tosWindows.add(idx.windowStart);
    });

    // 获取当前时间窗口
    const currentWindow = getTimeWindow(Date.now());

    // 清空并重建选项
    selector.innerHTML = '';

    // 添加当前窗口选项（总是显示）
    const currentOption = document.createElement('option');
    currentOption.value = currentWindow;
    currentOption.textContent = `${formatTimeWindow(currentWindow)} (当前窗口 - HNSW)`;
    selector.appendChild(currentOption);

    // 添加 HNSW 中的其他窗口
    const sortedHnswWindows = Array.from(hnswWindows).sort((a, b) => b - a);
    sortedHnswWindows.forEach(window => {
        if (window !== currentWindow) {
            const option = document.createElement('option');
            option.value = window;
            option.textContent = `${formatTimeWindow(window)} (HNSW)`;
            selector.appendChild(option);
        }
    });

    // 添加 TOS 中的窗口
    const sortedTosWindows = Array.from(tosWindows).sort((a, b) => b - a);
    sortedTosWindows.forEach(window => {
        const option = document.createElement('option');
        option.value = window;
        option.textContent = `${formatTimeWindow(window)} (TOS)`;
        selector.appendChild(option);
    });

    // 尝试恢复之前的选择
    if (currentSelection && selector.querySelector(`option[value="${currentSelection}"]`)) {
        selector.value = currentSelection;
    }
}

// D3.js 图形可视化
function initHNSWVisualization() {
    const container = document.getElementById('hnswGraph');
    const width = container.clientWidth;
    const height = 400;

    app.svg = d3.select('#hnswGraph')
        .append('svg')
        .attr('width', width)
        .attr('height', height);

    app.simulation = d3.forceSimulation()
        .force('link', d3.forceLink().id(d => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(25));
}

function updateHNSWGraph() {
    if (!app.svg) return;

    // 收集所有时间窗口
    const allWindows = new Set();
    app.hnswIndex.vectors.forEach(v => {
        allWindows.add(getTimeWindow(v.timestamp));
    });

    const nodes = app.hnswIndex.vectors.map(v => {
        const window = getTimeWindow(v.timestamp);
        return {
            id: v.id,
            vector: v,
            window: window,
            level: v.level, // 添加层级信息
            color: getColorForWindow(window, allWindows),
            x: v.x,
            y: v.y
        };
    });

    const links = [];
    app.hnswIndex.vectors.forEach(v => {
        // 只显示第0层的连接（最密集的层）
        const neighbors = v.neighbors[0] || [];
        neighbors.forEach(neighbor => {
            if (v.id < neighbor.id) {
                links.push({
                    source: v.id,
                    target: neighbor.id
                });
            }
        });
    });

    // 更新连线
    const link = app.svg.selectAll('.link')
        .data(links, d => `${d.source}-${d.target}`);

    link.exit().remove();

    link.enter()
        .append('line')
        .attr('class', 'link')
        .merge(link);

    // 更新节点
    const node = app.svg.selectAll('.node')
        .data(nodes, d => d.id);

    node.exit().remove();

    const nodeEnter = node.enter()
        .append('g')
        .attr('class', 'node')
        .call(d3.drag()
            .on('start', dragStarted)
            .on('drag', dragged)
            .on('end', dragEnded))
        .on('click', onNodeClick);

    nodeEnter.append('circle')
        .attr('r', d => 15 + d.level * 2) // 根据层级调整节点大小
        .attr('fill', d => d.color)
        .attr('stroke', d => d.level > 0 ? '#ff6b6b' : 'none') // 高层节点添加红色边框
        .attr('stroke-width', d => d.level > 0 ? 2 : 0);

    // 更新现有节点的颜色和大小
    node.select('circle')
        .attr('r', d => 15 + d.level * 2)
        .attr('fill', d => d.color)
        .attr('stroke', d => d.level > 0 ? '#ff6b6b' : 'none')
        .attr('stroke-width', d => d.level > 0 ? 2 : 0);

    nodeEnter.append('text')
        .attr('dy', 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '11px')
        .attr('fill', 'white')
        .attr('font-weight', 'bold')
        .text(d => d.id);

    // 添加层级标签
    nodeEnter.append('text')
        .attr('dy', -18)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#ff6b6b')
        .attr('font-weight', 'bold')
        .text(d => d.level > 0 ? `L${d.level}` : '');

    // 更新层级标签
    node.select('text:nth-of-type(2)')
        .text(d => d.level > 0 ? `L${d.level}` : '');

    // 更新模拟
    app.simulation.nodes(nodes);
    app.simulation.force('link').links(links);
    app.simulation.alpha(0.3).restart();

    app.simulation.on('tick', () => {
        app.svg.selectAll('.link')
            .attr('x1', d => {
                const source = nodes.find(n => n.id === d.source.id || n.id === d.source);
                return source ? source.x : 0;
            })
            .attr('y1', d => {
                const source = nodes.find(n => n.id === d.source.id || n.id === d.source);
                return source ? source.y : 0;
            })
            .attr('x2', d => {
                const target = nodes.find(n => n.id === d.target.id || n.id === d.target);
                return target ? target.x : 0;
            })
            .attr('y2', d => {
                const target = nodes.find(n => n.id === d.target.id || n.id === d.target);
                return target ? target.y : 0;
            });

        app.svg.selectAll('.node')
            .attr('transform', d => `translate(${d.x},${d.y})`);
    });
}

// D3.js 拖拽事件处理
function dragStarted(event, d) {
    if (!event.active) app.simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragEnded(event, d) {
    if (!event.active) app.simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

// 节点点击事件
function onNodeClick(event, d) {
    event.stopPropagation();

    // 取消之前选中的节点
    app.svg.selectAll('.node').classed('selected', false);

    // 选中当前节点
    d3.select(event.currentTarget).classed('selected', true);
    app.selectedNode = d.vector;

    // 显示向量详情
    showVectorDetail(d.vector);
}

function showVectorDetail(vector) {
    const detailPanel = document.getElementById('vectorDetail');
    const vectorInfo = document.getElementById('vectorInfo');

    const age = Math.floor((Date.now() - vector.timestamp) / 1000);
    const ageText = age < 60 ? `${age}秒` : `${Math.floor(age / 60)}分钟`;

    // 计算第0层的邻居数（与可视化一致）
    const layer0Neighbors = vector.neighbors[0] ? vector.neighbors[0].length : 0;

    // 计算所有层的邻居总数
    let totalNeighbors = 0;
    let neighborsByLayer = '';
    for (let layer in vector.neighbors) {
        const count = vector.neighbors[layer].length;
        totalNeighbors += count;
        if (count > 0) {
            const ids = vector.neighbors[layer].map(n => n.id).join(', ');
            const layerLabel = layer === '0' ? `层 ${layer} (可视化层)` : `层 ${layer}`;
            neighborsByLayer += `<div style="margin-left: 10px;"><strong>${layerLabel}:</strong> ${ids}</div>`;
        }
    }

    vectorInfo.innerHTML = `
        <div><strong>ID:</strong> ${vector.id}</div>
        <div><strong>层级:</strong> ${vector.level}</div>
        <div><strong>向量:</strong> [${vector.data.map(v => v.toFixed(3)).join(', ')}]</div>
        <div><strong>时间戳:</strong> ${new Date(vector.timestamp).toLocaleTimeString()}</div>
        <div><strong>年龄:</strong> ${ageText}</div>
        <div><strong>第0层邻居:</strong> ${layer0Neighbors} (图中显示的边)</div>
        <div><strong>所有层邻居:</strong> ${totalNeighbors}</div>
        ${neighborsByLayer || '<div style="margin-left: 10px;">无邻居</div>'}
    `;

    detailPanel.classList.remove('hidden');
}

// TOS Bucket 可视化
function updateTOSBucket() {
    const container = document.getElementById('tosBucket');
    container.innerHTML = '';

    if (app.tosBucket.indexes.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #687078;">暂无归档索引</div>';
        return;
    }

    app.tosBucket.indexes.forEach(index => {
        const card = document.createElement('div');
        card.className = 'index-card animating';

        card.innerHTML = `
            <div class="index-card-header">
                <div class="index-icon">I</div>
                <span>${index.name}</span>
            </div>
            <div class="index-card-body">
                <div>向量数: ${index.vectorCount}</div>
                <div>时间窗口: ${formatTimeWindow(index.windowStart)}</div>
            </div>
        `;

        container.appendChild(card);

        // 移除动画类
        setTimeout(() => card.classList.remove('animating'), 1000);
    });
}

// 向量插入功能
function insertVector() {
    const vectorData = generateRandomVector();
    const level = app.hnswIndex.randomLevel(); // 随机分配层级
    const vector = new Vector(app.vectorIdCounter++, vectorData, Date.now(), level);

    app.hnswIndex.insert(vector);

    updateHNSWGraph();
    updateStats();

    // 不显示通知，避免频繁打扰
    console.log(`向量 ${vector.id} 已插入 HNSW 索引 (层级: ${level})`);
}

// 完全自动的随机间隔插入
function scheduleNextInsert() {
    // 生成 5-10 秒之间的随机间隔
    const randomInterval = (Math.random() * 5 + 5) * 1000; // 5000-10000ms
    app.nextInsertTime = Date.now() + randomInterval;

    app.autoInsertTimer = setTimeout(() => {
        insertVector();
        scheduleNextInsert(); // 递归调度下一次插入
    }, randomInterval);

    // 更新状态显示
    updateAutoInsertStatus();
}

function updateAutoInsertStatus() {
    const statusElement = document.getElementById('autoInsertStatus');
    if (statusElement && app.nextInsertTime) {
        const remaining = Math.ceil((app.nextInsertTime - Date.now()) / 1000);
        statusElement.textContent = `运行中 (下次插入: ${remaining}秒后)`;
    }
}

// 启动自动插入
function startAutoInsert() {
    scheduleNextInsert();

    // 每秒更新状态显示
    setInterval(updateAutoInsertStatus, 1000);
}

// Flush 机制 - 基于时间窗口将向量写入 TOS
function flushToTOS() {
    const now = Date.now();
    const currentWindow = getTimeWindow(now);

    console.log(`当前时间: ${new Date(now).toLocaleTimeString()}`);
    console.log(`当前时间窗口: ${formatTimeWindow(currentWindow)}`);

    // 计算需要保留的最旧窗口的时间戳
    // retainWindowCount = 2 表示保留当前窗口和前1个窗口
    // 所以阈值窗口 = 当前窗口 - (retainWindowCount - 1) * 60000
    const retainThresholdWindow = currentWindow - (app.retainWindowCount - 1) * 60000;
    console.log(`保留阈值窗口: ${formatTimeWindow(retainThresholdWindow)} (保留此窗口及更新的)`);

    // 收集所有时间窗口用于日志
    const allWindows = new Set();
    app.hnswIndex.vectors.forEach(v => {
        allWindows.add(getTimeWindow(v.timestamp));
    });
    const sortedWindows = Array.from(allWindows).sort((a, b) => b - a);
    console.log(`HNSW 中的时间窗口:`, sortedWindows.map(w => formatTimeWindow(w)));

    // 移除早于保留阈值的窗口（< retainThresholdWindow）
    const oldVectors = app.hnswIndex.vectors.filter(v => {
        const vectorWindow = getTimeWindow(v.timestamp);
        return vectorWindow < retainThresholdWindow;
    });

    if (oldVectors.length > 0) {
        console.log(`需要 flush ${oldVectors.length} 个向量`);

        // 从 HNSW 中移除这些向量
        app.hnswIndex.vectors = app.hnswIndex.vectors.filter(v => {
            const vectorWindow = getTimeWindow(v.timestamp);
            return vectorWindow >= retainThresholdWindow;
        });

        // 清理邻居引用（所有层）
        const remainingIds = new Set(app.hnswIndex.vectors.map(v => v.id));
        app.hnswIndex.vectors.forEach(v => {
            for (let layer in v.neighbors) {
                v.neighbors[layer] = v.neighbors[layer].filter(n => remainingIds.has(n.id));
            }
        });

        // 如果入口点被移除，重新选择入口点
        if (app.hnswIndex.entryPoint && !remainingIds.has(app.hnswIndex.entryPoint.id)) {
            app.hnswIndex.entryPoint = null;
            app.hnswIndex.maxLevel = 0;

            // 找到层级最高的节点作为新入口点
            app.hnswIndex.vectors.forEach(v => {
                if (v.level > app.hnswIndex.maxLevel) {
                    app.hnswIndex.maxLevel = v.level;
                    app.hnswIndex.entryPoint = v;
                }
            });
        }

        // 按时间窗口分组
        const windowGroups = new Map();
        oldVectors.forEach(v => {
            const window = getTimeWindow(v.timestamp);
            if (!windowGroups.has(window)) {
                windowGroups.set(window, []);
            }
            windowGroups.get(window).push(v);
        });

        // 为每个时间窗口创建索引
        windowGroups.forEach((vectors, window) => {
            const index = app.tosBucket.putVectors(vectors, window);
            console.log(`创建索引 ${index.name}，包含 ${vectors.length} 个向量`);
        });

        updateHNSWGraph();
        updateTOSBucket();
        updateStats();
        updateTimeWindowOptions();

        showNotification(`Flush 完成: ${oldVectors.length} 个向量写入 ${windowGroups.size} 个索引`, 'info');
    } else {
        console.log(`无需 flush，所有向量都在保留窗口内`);
    }
}

// 手动 Flush
function manualFlush() {
    flushToTOS();
}

// 自动 Flush 定时器 - 对齐到整分钟 + 0.1秒
function startAutoFlush() {
    // 计算到下一个整分钟 + 0.1秒的延迟
    function getDelayToNextMinutePlus100ms() {
        const now = new Date();
        const seconds = now.getSeconds();
        const milliseconds = now.getMilliseconds();
        // 计算到下一个整分钟的延迟，然后加上100ms
        return (60 - seconds) * 1000 - milliseconds + 100;
    }

    // 首次flush在下一个整分钟 + 0.1秒执行
    const initialDelay = getDelayToNextMinutePlus100ms();

    setTimeout(() => {
        flushToTOS();
        // 之后每60秒执行一次（在整分钟 + 0.1秒时刻）
        setInterval(() => {
            flushToTOS();
        }, 60000);
    }, initialDelay);

    // 更新倒计时显示
    setInterval(() => {
        const nextFlush = document.getElementById('nextFlush');
        const now = new Date();
        const seconds = now.getSeconds();
        const remaining = 60 - seconds;
        nextFlush.textContent = `${remaining}s`;
    }, 1000);
}

// 查询路由 - 根据时间窗口决定查询 HNSW 还是 TOS
function executeQuery() {
    console.log('=== 开始执行查询 ===');

    const queryInput = document.getElementById('queryVector').value.trim();
    const selectedWindow = parseInt(document.getElementById('timeWindow').value);
    const topK = parseInt(document.getElementById('topK').value) || 1;

    console.log('查询参数:', { queryInput, selectedWindow, topK });
    console.log('当前 HNSW 向量数:', app.hnswIndex.vectors.length);

    // 解析或生成查询向量
    let queryData;
    let isRandomGenerated = false;

    try {
        if (queryInput === '') {
            queryData = generateRandomVector();
            isRandomGenerated = true;
            console.log('✓ 生成随机查询向量:', queryData);
        } else {
            queryData = queryInput.split(',').map(v => parseFloat(v.trim()));
            if (queryData.length !== 4 || queryData.some(isNaN)) {
                throw new Error('向量必须是4维');
            }
            console.log('✓ 使用输入的查询向量:', queryData);
        }
    } catch (e) {
        console.error('✗ 查询向量解析失败:', e);
        showNotification('请输入有效的4维向量，例如: 0.5, 0.3, 0.8, 0.2', 'error');
        return;
    }

    const queryVector = new Vector(-1, queryData, Date.now());

    // 使用选中的时间窗口
    const targetWindow = selectedWindow;

    // 收集HNSW中的所有时间窗口
    const hnswWindows = new Set();
    app.hnswIndex.vectors.forEach(v => {
        hnswWindows.add(getTimeWindow(v.timestamp));
    });

    console.log(`目标时间窗口: ${formatTimeWindow(targetWindow)}`);
    console.log(`HNSW 中的窗口:`, Array.from(hnswWindows).map(w => formatTimeWindow(w)));

    let results;
    let queryPath;

    // 路由决策：如果目标窗口在 HNSW 中，走 HNSW；否则走 TOS
    if (hnswWindows.has(targetWindow)) {
        queryPath = 'HNSW 索引 (内存层)';
        console.log('→ 查询路径: HNSW');
        results = app.hnswIndex.search(queryVector, topK);
        console.log('✓ HNSW 查询结果数量:', results.length);
    } else {
        queryPath = 'TOS Vector Bucket (持久化层)';
        console.log('→ 查询路径: TOS');
        results = app.tosBucket.queryVectors(queryVector, targetWindow, topK);
        console.log('✓ TOS 查询结果数量:', results.length);
    }

    console.log('=== 查询完成，准备显示结果 ===');
    displayQueryResults(results, queryPath, queryVector, topK, isRandomGenerated, targetWindow);
}

function displayQueryResults(results, queryPath, queryVector, topK, isRandomGenerated, targetWindow) {
    const resultSection = document.getElementById('queryResultSection');
    const resultContainer = document.getElementById('queryResult');

    resultSection.style.display = 'block';

    let html = `<div class="query-path">查询路径: ${queryPath}</div>`;
    html += `<div style="margin-bottom: 12px; padding: 8px; background-color: #e8f4f8; border-radius: 4px; color: #0073bb;">
        <strong>查询时间窗口:</strong> ${formatTimeWindow(targetWindow)}
    </div>`;

    if (isRandomGenerated) {
        html += `<div style="margin-bottom: 12px; padding: 8px; background-color: #fff3cd; border-radius: 4px; color: #856404;">
            <strong>随机生成的查询向量:</strong> [${queryVector.data.map(v => v.toFixed(3)).join(', ')}]
        </div>`;
    } else {
        html += `<div style="margin-bottom: 12px; color: #545b64;">查询向量: [${queryVector.data.map(v => v.toFixed(3)).join(', ')}]</div>`;
    }

    if (results.length === 0) {
        html += '<div style="padding: 20px; text-align: center; color: #687078;">未找到匹配的向量</div>';
    } else {
        html += `<h4 style="margin-bottom: 12px;">Top ${topK} 最近邻:</h4>`;
        results.forEach((result, index) => {
            // 调试：打印结果对象
            console.log(`结果 #${index + 1}:`, result);

            const vector = result.vector || result;
            console.log(`  向量对象:`, vector);
            console.log(`  向量数据:`, vector.data);

            let distance;

            // 确保 distance 是数字类型
            if (result.distance !== undefined && result.distance !== null) {
                distance = Number(result.distance);
                console.log(`  使用已有距离: ${distance}`);
            } else if (vector && vector.data && queryVector && queryVector.data) {
                // 手动计算距离
                let sum = 0;
                for (let i = 0; i < vector.data.length; i++) {
                    sum += Math.pow(vector.data[i] - queryVector.data[i], 2);
                }
                distance = Math.sqrt(sum);
                console.log(`  计算距离: ${distance}`);
            } else {
                distance = 0;
                console.error(`  无法计算距离，向量数据不完整`);
            }

            html += `
                <div class="result-item">
                    <div><strong>#${index + 1}</strong> - 向量 ID: ${vector.id}</div>
                    <div>向量: [${vector.data.map(v => v.toFixed(3)).join(', ')}]</div>
                    <div>距离: ${distance.toFixed(4)}</div>
                    <div>时间: ${new Date(vector.timestamp).toLocaleString()}</div>
                </div>
            `;
        });
    }

    resultContainer.innerHTML = html;
    showNotification(`查询完成，找到 ${results.length} 个结果`);
}

// 事件监听器
function setupEventListeners() {
    document.getElementById('executeQuery').addEventListener('click', executeQuery);

    // 点击空白处取消选中
    document.getElementById('hnswGraph').addEventListener('click', (e) => {
        if (e.target.tagName === 'svg') {
            app.svg.selectAll('.node').classed('selected', false);
            document.getElementById('vectorDetail').classList.add('hidden');
        }
    });
}

// 应用初始化
function init() {
    initHNSWVisualization();
    updateTOSBucket();
    updateStats();
    setupEventListeners();
    startAutoFlush();
    startAutoInsert(); // 启动自动插入

    showNotification('系统初始化完成，自动插入已启动', 'info');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
