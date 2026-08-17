# 云服务器 + Docker + Nginx 部署步骤

这份说明默认服务器系统为 `Ubuntu 22.04/24.04`，项目路径假设为：

```bash
/opt/hot-monitor
```

## 结果

部署完成后，别人可以通过你的公网地址访问，例如：

```bash
http://你的服务器公网IP
```

如果你后面再绑定域名和 HTTPS，最终访问地址可以变成：

```bash
https://你的域名
```

## 第一步：准备服务器

登录你的云服务器：

```bash
ssh root@你的服务器公网IP
```

更新系统：

```bash
apt update && apt upgrade -y
```

开放端口：

- 安全组里放行 `80`
- 如果后面要 HTTPS，再放行 `443`

如果你服务器启用了 `ufw`，执行：

```bash
ufw allow 80
ufw allow 443
ufw allow OpenSSH
ufw enable
```

## 第二步：安装 Docker

执行：

```bash
apt update
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
```

验证：

```bash
docker --version
docker compose version
```

## 第三步：上传项目

在服务器创建目录：

```bash
mkdir -p /opt/hot-monitor
```

把本地项目整体上传到服务器这个目录。

你可以用任一方式：

### 方式 A：用 Git

如果你已经把项目传到 GitHub：

```bash
cd /opt
git clone 你的仓库地址 hot-monitor
cd /opt/hot-monitor
```

### 方式 B：直接上传文件

把整个项目目录上传到：

```bash
/opt/hot-monitor
```

## 第四步：启动服务

进入项目目录：

```bash
cd /opt/hot-monitor
```

构建并启动：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

## 第五步：访问网页

浏览器打开：

```bash
http://你的服务器公网IP
```

如果能打开，就说明部署完成。

## 目录说明

这个项目已经给你准备好以下部署文件：

- `Dockerfile`
- `docker-compose.yml`
- `deploy/nginx/default.conf`

其中：

- `app` 容器运行 Node.js 服务
- `nginx` 容器对外暴露 `80` 端口
- `./data:/app/data` 用来持久化热点历史数据

## 日常更新

以后代码有更新时：

```bash
cd /opt/hot-monitor
docker compose down
docker compose up -d --build
```

如果你是 Git 拉代码：

```bash
cd /opt/hot-monitor
git pull
docker compose up -d --build
```

## 常用排查

### 看容器状态

```bash
docker compose ps
```

### 看服务日志

```bash
docker compose logs -f app
docker compose logs -f nginx
```

### 测试本机是否通

```bash
curl http://127.0.0.1
```

### 如果外网打不开

重点检查：

1. 云服务器安全组是否放行 `80`
2. `ufw` 是否放行 `80`
3. `docker compose ps` 是否都在运行
4. `docker compose logs -f nginx` 是否有报错

## 域名和 HTTPS

如果你后面要绑定域名，可以这样做：

1. 域名 DNS `A 记录` 指向你的服务器公网 IP
2. 把 `deploy/nginx/default.conf` 里的：

```nginx
server_name _;
```

改成：

```nginx
server_name 你的域名;
```

3. 重启 Nginx：

```bash
docker compose up -d --build
```

如果后面你要，我还可以继续给你补：

- HTTPS 版 Nginx 配置
- Certbot 申请证书步骤
- 域名版完整上线清单
