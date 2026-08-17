# Railway 部署说明

这套项目可以直接部署到 Railway，别人之后通过 Railway 给你的公网地址就能访问。

## 适合你现在的方案

如果你当前只是想：

- 先快速上线一个别人能打开的网页
- 暂时不自己维护云服务器

那 Railway 是最省事的。

## 部署前提

你需要准备：

1. 一个 GitHub 账号
2. 一个 Railway 账号
3. 把当前项目上传到 GitHub 仓库

## 第一步：把项目传到 GitHub

如果你还没建仓库，最简单流程是：

```bash
git init
git add .
git commit -m "init hot monitor"
git branch -M main
git remote add origin 你的GitHub仓库地址
git push -u origin main
```

如果你已经有仓库，直接把当前项目推上去就行。

## 第二步：在 Railway 新建项目

打开 Railway：

- [https://railway.app](https://railway.app)

然后：

1. 登录
2. 点 `New Project`
3. 选择 `Deploy from GitHub repo`
4. 选择你的这个仓库

Railway 会自动识别项目里的 `Dockerfile`，直接按 Docker 部署。

如果你之前遇到的是 `Build image failed`：

- 先确认 GitHub 仓库里已经有最新的 `Dockerfile`
- 当前版本的 `Dockerfile` 不再依赖仓库里必须存在 `data/` 目录
- 如果 Railway 还是拿的是旧提交，记得先 `git push` 再点 Railway 的 `Redeploy`

## 第三步：等待部署完成

部署成功后，Railway 会给你一个默认公网地址，通常长这样：

```text
https://xxx.up.railway.app
```

别人直接打开这个地址就能访问你的热点监控网页。

## 第四步：确认服务是否正常

部署完成后，打开公网地址，检查：

1. 页面是否能正常加载
2. 抖音、微博、小红书、快手、百度榜单是否正常显示
3. 搜索功能是否可用
4. 切换抖音同城地区是否正常

## Railway 上的注意事项

这个项目会把历史记录写到：

```text
data/hot-monitor-store.json
```

所以要注意一件事：

- Railway 更适合快速上线
- 但它的文件系统不适合长期当数据库
- 如果服务重启、重建、迁移，历史记录可能丢失
- 所以搜索里的“近 15 日历史”可以先用，但不适合作为长期稳定存档

也就是说：

- 当前榜单展示没问题
- 但“近 15 日历史累积”在 Railway 上不一定长期稳定

如果你后面很在意历史数据不丢，还是更适合迁到：

- 云服务器 + Docker + 持久磁盘
- 或改成数据库存储

## 当前项目为什么能直接上 Railway

因为已经准备好了这些文件：

- `Dockerfile`
- `.dockerignore`

Railway 读取 `Dockerfile` 后就能直接构建并运行你的服务。

## 更新代码

以后如果你改了代码，只要再推送到 GitHub：

```bash
git add .
git commit -m "update"
git push
```

Railway 一般会自动重新部署。

## 如果部署失败

重点检查：

1. GitHub 仓库是否完整上传
2. `Dockerfile` 是否存在
3. Railway 构建日志里有没有报错
4. Railway 是否已经拿到最新提交，而不是旧版本代码
5. 部署成功后如果页面打不开，再看服务日志里是否监听了 `PORT` 对应端口

## 下一步

如果你愿意，我下一步还能继续帮你做两件事：

1. 帮你整理一份 `GitHub 上传步骤`
2. 帮你补一份 `Railway 部署后如何绑定自定义域名` 的说明
