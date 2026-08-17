# 多平台热点监控部署说明

这个项目是一个纯 Node.js 服务，不是静态网页。  
如果想让其他人直接访问，你需要把它部署到一台公网服务器，或者一个支持 Node.js / Docker 的云平台。

## 最推荐

最省事的做法有 3 种：

1. 云服务器 + Docker
2. Railway 部署 Docker 项目
3. Render 部署 Docker 项目

如果你只是想尽快让别人打开访问，优先选 `Railway` 或 `Render`。  
如果你想完全可控、以后还能挂域名、配反代，选 `云服务器 + Docker`。

## 方式一：云服务器

适合：

- 想长期用
- 想绑定自己的域名
- 想自己控制数据文件

### 准备

- 一台 Linux 云服务器
- 已安装 Docker
- 已开放服务器安全组端口，例如 `80`、`443`，或临时开放 `3000`

### 上传项目

把整个项目上传到服务器，例如放到：

```bash
/opt/hot-monitor
```

### 构建镜像

```bash
docker build -t hot-monitor .
```

### 启动容器

```bash
docker run -d \
  --name hot-monitor \
  -p 3000:3000 \
  -v /opt/hot-monitor/data:/app/data \
  --restart unless-stopped \
  hot-monitor
```

说明：

- `-p 3000:3000`：把服务暴露到公网
- `-v /opt/hot-monitor/data:/app/data`：把历史数据持久化，避免容器重启后丢失
- `--restart unless-stopped`：服务器重启后自动恢复

### 访问

如果你的服务器公网 IP 是 `1.2.3.4`，那么可以直接访问：

```bash
http://1.2.3.4:3000
```

### 更推荐

实际线上建议再配一个 Nginx：

- 域名反向代理到 `3000`
- 开 HTTPS
- 最终地址做成：

```bash
https://your-domain.com
```

## 方式二：Railway

适合：

- 不想自己管服务器
- 想最快上线一个公网地址

### 步骤

1. 把当前项目上传到 GitHub
2. 登录 Railway
3. 新建项目，选择从 GitHub 仓库部署
4. Railway 会识别 `Dockerfile`
5. 部署完成后，生成一个公网地址

### 注意

这个项目会把历史记录写到 `data/hot-monitor-store.json`。  
如果平台的文件系统不是持久化的，那么：

- 重启或重新部署后
- 历史搜索数据可能会丢失

所以如果你很在意“近 15 日历史累积”，要么：

- 选择带持久磁盘的方案
- 要么改成数据库存储

## 方式三：Render

适合：

- 想和 Railway 类似地快速上线
- 接受云平台托管

### 步骤

1. 把项目传到 GitHub
2. 在 Render 新建 Web Service
3. 连接 GitHub 仓库
4. 选择 Docker 部署
5. 部署完成后拿到公网地址

### 注意

和 Railway 一样，如果没有持久磁盘：

- 历史文件可能不会长期保留

## 上线后别人怎么访问

部署成功后，别人直接打开你的公网地址就行，例如：

- `https://your-app.up.railway.app`
- `https://your-app.onrender.com`
- `https://your-domain.com`

## 当前项目文件

部署相关文件已经准备好：

- `Dockerfile`
- `.dockerignore`

核心服务文件：

- `server.mjs`
- `public/index.html`
- `public/app.js`
- `public/styles.css`

## 我建议你怎么选

如果你现在只是想：

- 尽快给别人一个可访问地址

就选：

- `Railway`

如果你想：

- 稳定长期使用
- 保存历史数据
- 绑定域名

就选：

- `云服务器 + Docker + Nginx`

## 下一步

如果你愿意，我可以继续直接帮你做其中一种准备：

1. 生成一份 `服务器部署命令清单`
2. 生成 `Nginx 配置`
3. 帮你整理成适合 `Railway` 的仓库结构
4. 帮你整理成适合 `Render` 的仓库结构
