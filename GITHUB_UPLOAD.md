# GitHub 上传步骤

这份说明适合你把当前项目上传到 GitHub，然后再接着部署到 Railway。

## 准备

你需要先有：

1. 一个 GitHub 账号
2. 本机已安装 Git

如果你还没装 Git，可以先安装：

- Windows: 安装 Git for Windows
- Mac: 安装 Xcode Command Line Tools 或 Homebrew 的 git

安装后，在终端执行：

```bash
git --version
```

如果能看到版本号，说明 Git 已经可用。

## 第一步：在 GitHub 创建仓库

打开 GitHub：

- [https://github.com](https://github.com)

然后：

1. 点击右上角 `+`
2. 选择 `New repository`
3. 输入仓库名，例如：

```text
hot-monitor-dashboard
```

4. 选择 `Public` 或 `Private`
5. 不要勾选：
   - `Add a README file`
   - `Add .gitignore`
   - `Choose a license`

最后点击 `Create repository`

创建完后，GitHub 会给你一个仓库地址，通常像这样：

```bash
https://github.com/你的用户名/hot-monitor-dashboard.git
```

或者：

```bash
git@github.com:你的用户名/hot-monitor-dashboard.git
```

## 第二步：打开项目目录

在终端进入你的项目目录。

如果你的项目就在当前文件夹，确保里面能看到这些文件：

- `package.json`
- `server.mjs`
- `public/`
- `Dockerfile`

## 第三步：初始化 Git 仓库

在项目目录执行：

```bash
git init
```

## 第四步：添加文件

执行：

```bash
git add .
```

## 第五步：提交代码

执行：

```bash
git commit -m "init hot monitor dashboard"
```

如果这里提示你还没配置 Git 用户名和邮箱，先执行：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

然后再重新执行：

```bash
git commit -m "init hot monitor dashboard"
```

## 第六步：绑定 GitHub 仓库

把下面这条里的地址换成你的仓库地址：

```bash
git remote add origin https://github.com/你的用户名/hot-monitor-dashboard.git
```

## 第七步：切到主分支

执行：

```bash
git branch -M main
```

## 第八步：推送到 GitHub

执行：

```bash
git push -u origin main
```

如果 GitHub 弹出登录验证，就按提示完成。

## 上传完成后

上传成功后，你刷新 GitHub 仓库页面，就能看到项目文件了。

然后你就可以继续去 Railway：

1. 登录 Railway
2. 选择 `Deploy from GitHub repo`
3. 选择这个仓库
4. 开始部署

## 以后更新代码

如果你后面又改了项目，继续上传只要这几步：

```bash
git add .
git commit -m "update"
git push
```

## 常见报错

### 1. remote origin already exists

说明你已经绑定过远程仓库了。

可以先查看：

```bash
git remote -v
```

如果要改地址，执行：

```bash
git remote set-url origin 你的仓库地址
```

### 2. rejected / failed to push

一般是远程仓库里已经有内容，或者你本地和远程分支不一致。

可以先执行：

```bash
git pull --rebase origin main
git push
```

### 3. Authentication failed

说明登录没过，常见原因是：

- GitHub 没登录
- HTTPS 推送需要 token
- SSH key 没配置

如果你不想折腾，最简单就是：

- 用 GitHub Desktop
- 或按 GitHub 网页提示完成登录

## 最简命令汇总

如果你已经创建好了 GitHub 空仓库，那么实际最常用的是这几条：

```bash
git init
git add .
git commit -m "init hot monitor dashboard"
git branch -M main
git remote add origin 你的仓库地址
git push -u origin main
```
