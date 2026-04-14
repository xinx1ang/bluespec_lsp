import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient;

// 获取当前平台对应的二进制文件路径
function getPlatformBinaryPath(context: vscode.ExtensionContext): string {
    const extensionPath = context.extensionPath;
    
    // 根据平台和架构确定文件名和目录结构
    const platform = os.platform();
    const arch = os.arch();
    
    let platformName: string;
    let binaryName: string;
    
    switch (platform) {
        case 'win32':
            platformName = 'win32';
            binaryName = 'bsv-language-server.exe';
            break;
        case 'darwin':
            platformName = 'darwin';
            binaryName = 'bsv-language-server';
            break;
        default: // linux, freebsd, etc.
            platformName = 'linux';
            binaryName = 'bsv-language-server';
            break;
    }
    
    // 根据架构确定目录
    let archName: string;
    if (arch === 'arm64' || arch === 'aarch64') {
        archName = 'arm64';
    } else if (arch === 'x64' || arch === 'x86_64') {
        archName = 'x64';
    } else {
        archName = arch; // fallback
    }
    
    // 优先尝试 platform-arch 目录结构
    const platformArchPath = path.join(extensionPath, 'server', `${platformName}-${archName}`, binaryName);
    
    // 兼容性：也尝试根目录
    const rootPath = path.join(extensionPath, 'server', binaryName);
    
    // 检查文件是否存在
    if (fs.existsSync(platformArchPath)) {
        return platformArchPath;
    } else if (fs.existsSync(rootPath)) {
        return rootPath;
    }
    
    // 如果都没有找到，返回空字符串
    return '';
}

export function activate(context: vscode.ExtensionContext) {
    console.log('BSV Language Server extension is now active!');
    
    // 获取配置
    const config = vscode.workspace.getConfiguration('bsv');
    const serverPath = config.get<string>('languageServer.path');
    const traceServer = config.get<string>('languageServer.trace.server') || 'off';
    const enable = config.get<boolean>('languageServer.enable', true);
    
    if (!enable) {
        console.log('BSV language server is disabled by configuration.');
        return;
    }
    
    // 确定服务器路径
    let serverModule: string;
    
    if (serverPath && serverPath.trim() !== '') {
        // 使用用户指定的路径
        serverModule = serverPath;
        console.log(`Using user-specified server path: ${serverModule}`);
    } else {
        // 尝试使用扩展包内的二进制文件
        serverModule = getPlatformBinaryPath(context);
        
        if (serverModule && fs.existsSync(serverModule)) {
            console.log(`Using bundled server binary: ${serverModule}`);
            
            // 确保二进制文件可执行（非Windows平台）
            if (os.platform() !== 'win32') {
                try {
                    fs.chmodSync(serverModule, 0o755);
                    console.log(`Set executable permissions for ${serverModule}`);
                } catch (err) {
                    console.warn(`Failed to set executable permissions: ${err}`);
                }
            }
        } else {
            // 回退到默认路径（开发环境）
            const defaultPaths = [
                context.asAbsolutePath(path.join('..', 'bsv-language-server', 'target', 'release', 'bsv-language-server')),
                context.asAbsolutePath(path.join('..', 'target', 'release', 'bsv-language-server')),
            ];
            
            const foundPath = defaultPaths.find((p: string) => fs.existsSync(p));
            serverModule = foundPath || 'bsv-language-server';
            
            if (!fs.existsSync(serverModule)) {
                console.warn(`BSV language server executable not found at ${serverModule}, falling back to PATH lookup.`);
                serverModule = 'bsv-language-server';
            }
        }
    }
    
    console.log(`Final server module: ${serverModule}`);
    
    // 服务器选项
    const serverOptions: ServerOptions = {
        run: {
            command: serverModule,
            args: [],
            transport: TransportKind.stdio
        },
        debug: {
            command: serverModule,
            args: ['--debug'],
            transport: TransportKind.stdio
        }
    };
    
    // 客户端选项
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'bsv' },
            { scheme: 'untitled', language: 'bsv' }
        ],
        synchronize: {
            // 同步配置更改
            configurationSection: 'bsv',
            // 通知服务器文件更改
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.bsv'),
                vscode.workspace.createFileSystemWatcher('**/*.bs')
            ]
        },
        outputChannel: vscode.window.createOutputChannel('BSV Language Server'),
        traceOutputChannel: vscode.window.createOutputChannel('BSV Language Server Trace'),
        initializationOptions: {
            // 传递给服务器的初始化选项
            workspaceFolders: vscode.workspace.workspaceFolders ? 
                vscode.workspace.workspaceFolders.map(folder => folder.uri.toString()) : []
        }
    };
    
    // 创建语言客户端
    client = new LanguageClient(
        'bsvLanguageServer',
        'BSV Language Server',
        serverOptions,
        clientOptions
    );
    
    // 设置跟踪级别
    client.setTrace(traceServer === 'verbose' ? 2 : traceServer === 'messages' ? 1 : 0);
    
    // 启动客户端
    client.start().then(() => {
        console.log('BSV Language Server client started successfully.');
        
        // 注册命令
        context.subscriptions.push(
            vscode.commands.registerCommand('bsv.restartServer', async () => {
                await client.stop();
                await client.start();
                vscode.window.showInformationMessage('BSV Language Server restarted.');
            }),
            
            vscode.commands.registerCommand('bsv.showOutput', () => {
                client.outputChannel.show();
            })
        );
    }).catch((err: any) => {
        vscode.window.showErrorMessage(`Failed to start BSV Language Server: ${err.message}`);
        console.error('Failed to start BSV Language Server:', err);
    });
    
    // 添加到订阅列表
    context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}