declare var document: any;
declare var window: any;
import * as vscode from 'vscode';
import * as pp from 'puppeteer';
import * as path from 'path';
export class VJudge {
    private browser?: pp.Browser;
    public userId?: string;
    private username?: string;
    private password?: string;
    public loggedin: boolean;
    public infoProvider: VJudgeInfoProvider;
    constructor(){
        this.infoProvider = new VJudgeInfoProvider(this);
        this.loggedin = false;
    }
    ensureBrowser = async () => {
        if(!this.browser){
            this.browser = await pp.launch({ headless: true });
        }
    };
    login = async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Logging in...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            await this.ensureBrowser();
            progress.report({ increment: 10 });
            if(!this.username){
                this.username = await vscode.window.showInputBox({ placeHolder: 'VJudge Username' });
                if(!this.username){
                    vscode.window.showErrorMessage('Please type username!');
                    return Promise.resolve();
                }
            }
            if(!this.password){
                this.password = await vscode.window.showInputBox({ placeHolder: 'VJudge Password' });
                if(!this.password){
                    vscode.window.showErrorMessage('Please type password!');
                    return Promise.resolve();
                }
            }
            progress.report({ increment: 10 });
            const loginPage = await this.browser!.newPage();
            await loginPage.goto('https://vjudge.net');
            progress.report({ increment: 30 });
            const loginButtonText = await loginPage.evaluate(() => document.querySelector('#navbarResponsive > ul > li:nth-child(8) > a').innerText);
            const loginButton = await loginPage.$('#navbarResponsive > ul > li:nth-child(8) > a');
            if(!loginButton || loginButtonText !== 'Login'){
                vscode.window.showErrorMessage('Already signed in!');
                return Promise.resolve();
            }
            await loginButton.click();
            await loginPage.waitForTimeout(1000);
            await loginPage.type('#login-username', this.username);
            await loginPage.type('#login-password', this.password);
            await loginPage.click('#btn-login');
            progress.report({ increment: 20 });
            while(true){
                try{
                    await loginPage.waitForNavigation({
                        timeout: 1000
                    });
                }catch{
                    const error = await loginPage.evaluate(() => {
                        if(!document.querySelector('#login-alert') || document.querySelector('#login-alert').style.display === 'none'){
                            return undefined;
                        }else{
                            return document.querySelector('#login-alert').innerText;
                        }
                    });
                    if(!error){
                        const loginButtonText = await loginPage.evaluate(() => document.querySelector('#navbarResponsive > ul > li:nth-child(8) > a').innerText);
                        if(loginButtonText !== 'Login'){
                            break;
                        }
                        continue;
                    }else{
                        vscode.window.showErrorMessage(error);
                        return Promise.resolve();
                    }
                }
                break;
            }
            progress.report({ increment: 25 });
            const usernameFromPage = await loginPage.evaluate(() => document.querySelector('#userNameDropdown').innerText);
            await loginPage.goto(`https://vjudge.net/user/${usernameFromPage}`);
            this.userId = await loginPage.evaluate(() => document.querySelector('#visitor_userId').value);
            vscode.window.showInformationMessage(`Logged in as ${usernameFromPage}(#${this.userId})!`);
            this.loggedin = true;
            loginPage.close();
            this.infoProvider.register();
            return Promise.resolve();
        });
    };
    fetchContestList = async (): Promise<[]> => {
        await this.ensureBrowser();
        const contestListPage = await this.browser!.newPage();
        await contestListPage.goto('https://vjudge.net/contest/data?draw=4&start=0&length=100&sortDir=desc&sortCol=0&category=mine&running=0&title=&owner=');
        const contests = (await contestListPage.evaluate(() => JSON.parse(document.body.innerText))).data;
        contestListPage.close();
        return contests;
    };
    fetchContestProblems = async (contestId: string) => {
        await this.ensureBrowser();
        const contestDetailPage = await this.browser!.newPage();
        await contestDetailPage.goto(`https://vjudge.net/contest/${contestId}#overview`);
        const problems = (await contestDetailPage.evaluate(() => JSON.parse(document.querySelector('body > textarea').innerText).problems));
        contestDetailPage.close();
        return problems;
    };
    openProblemDescription = async (descriptionId: string, descriptionVersion: string, title: string) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching Problem Description...',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            await this.ensureBrowser();
            progress.report({ increment: 10 });
            const descriptionPage = await this.browser!.newPage();
            progress.report({ increment: 20 });
            await descriptionPage.setRequestInterception(true);
            descriptionPage.on('request', (request) => {
                if (request.url().indexOf('mathjax') !== -1) {
                    request.abort();
                } else {
                    request.continue();
                }
            });
            await descriptionPage.goto(`https://vjudge.net/problem/description/${descriptionId}?${descriptionVersion}`);
            progress.report({ increment: 40 });
            const panel = vscode.window.createWebviewPanel('vjudge',
                title,
                vscode.ViewColumn.Two,
                {
                    enableScripts: true
                });
            panel.webview.html = await descriptionPage.evaluate(() => {
                document.querySelector('style').remove();
                let newStyle = document.createElement('style');
                newStyle.innerHTML = `
                dt {
                    font-weight: bold;
                    margin-top: 20px;
                    padding-left: 5px;
                }
                dd {
                    line-height: 26px;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                    margin-inline-start: 10px;
                }
                pre {
                    white-space: pre-wrap; /* Since CSS 2.1 */
                    white-space: -moz-pre-wrap; /* Mozilla, since 1999 */
                    white-space: -pre-wrap; /* Opera 4-6 */
                    white-space: -o-pre-wrap; /* Opera 7 */
                    word-wrap: break-word; /* Internet Explorer 5.5+ */
                }`;
                document.head.appendChild(newStyle);
                return document.documentElement.innerHTML;
            });
            progress.report({ increment: 30 });
            descriptionPage.close();
            return Promise.resolve();
        });
    };
    submitCode = async (contestId: string, problemNum: string, code: string) => {
        await this.ensureBrowser();
        const submitCodePage = await this.browser!.newPage();
        let succeed = false;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Submitting Code...',
            cancellable: true
        }, async (progress, token) => {
            progress.report({ increment: 20 });
            await submitCodePage.goto(`https://vjudge.net/contest/${contestId}#problem/${problemNum}`);
            await submitCodePage.click('#problem-submit');
            await submitCodePage.waitForTimeout(1000);
            progress.report({ increment: 20 });
            const languageList = await submitCodePage.evaluate((problemNum) => {
                document.querySelector('#contest-num').value = problemNum;
                let languages = Array.apply(null,document.querySelector('#submit-language').options)
                .map((option: any) => {
                    return {
                        name: option.innerText,
                        value: option.value
                    };
                });
                languages.shift();
                return languages;
            }, problemNum);
            if(token.isCancellationRequested){
                vscode.window.showErrorMessage('Cancelled');
                return Promise.resolve();
            }
            const chosenLanguage = await vscode.window.showQuickPick(
                languageList.map(obj => obj.name),
                { 
                    canPickMany: false,
                    placeHolder: 'Language'
                });
            progress.report({ increment: 20 });
            if(!chosenLanguage){
                vscode.window.showErrorMessage('Please choose language!');
                return Promise.resolve();
            }
            const chosenLanguageValue = await languageList.find(obj => obj.name === chosenLanguage)!.value;
            await submitCodePage.evaluate((chosenLanguageValue, code) => {
                document.querySelector('#submit-language').value = chosenLanguageValue;
                document.querySelector('#submit-solution').value = code;
            }, chosenLanguageValue, code);
            if(token.isCancellationRequested){
                vscode.window.showErrorMessage('Cancelled');
                return Promise.resolve();
            }
            progress.report({ increment: 20 });
            await submitCodePage.click('#btn-submit');
            succeed = true;
            return Promise.resolve();
        });
        if(!succeed){
            submitCodePage.close();
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Judge',
            cancellable: false
        }, async (progress) => {
            let status = 'pending';
            let text = 'Pending';
            while(true){
                console.log(status,text);
                progress.report({ message: text });
                let result;
                try {
                    result = await submitCodePage.evaluate(() => {
                        return {
                            status: document.querySelector('#info-panel > table > tbody > tr:nth-child(1) > td').parentElement.className,
                            text: document.querySelector('#info-panel > table > tbody > tr:nth-child(1) > td').innerText
                        };
                    });
                }catch{
                    const error = await submitCodePage.evaluate(() => {
                        if(!document.querySelector('#submit-alert') || document.querySelector('#submit-alert').style.display === 'none'){
                            return undefined;
                        }else{
                            return document.querySelector('#submit-alert').innerText;
                        }
                    });
                    if(!error){
                        await submitCodePage.waitForTimeout(100);
                        continue;
                    }else{
                        vscode.window.showErrorMessage(error);
                        return Promise.resolve();
                    }
                }
                status = result.status;
                text = result.text;
                if(status !== 'pending'){
                    break;
                }
                await submitCodePage.waitForTimeout(200);
                console.log(status,text);
            }
            console.log(status,text);
            if(status === 'failed'){
                vscode.window.showErrorMessage(text);
            }else{
                vscode.window.showInformationMessage(text);
            }
            return Promise.resolve();
        });
        //Wait for VJudge to update submission status
        setTimeout(() => {
            this.infoProvider.refresh();
        }, 15000);
        submitCodePage.close();
    };
    fetchSubmissions = async (contestId: string) => {
        await this.ensureBrowser();
        const contestRankPage = await this.browser!.newPage();
        await contestRankPage.goto(`https://vjudge.net/contest/rank/single/${contestId}`);
        const submissions = (await contestRankPage.evaluate(() => JSON.parse(document.body.innerText))).submissions;
        contestRankPage.close();
        return submissions;
    };
}
class VJudgeInfoProvider implements vscode.TreeDataProvider<VJudgeInfoNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	private registered: boolean;
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
    data: {
        contestRootNode: VJudgeInfoNode,
        contests: [],
        contestsNodeCache: Map<number, VJudgeInfoNode>
    };
    vjudge: VJudge;
    constructor(vjudge: VJudge){
        this.registered = false;
        this.data = {
            contestRootNode: new VJudgeInfoNode('Contests', vscode.TreeItemCollapsibleState.Expanded),
            contests: [],
            contestsNodeCache: new Map()
        };
        this.vjudge = vjudge;
    }
    register(){
        if(this.registered){
            return;
        }
        vscode.window.registerTreeDataProvider('vjudgeinfo', this);
        vscode.window.createTreeView('vjudgeinfo', {
            treeDataProvider: this
        });
        this.registered = true;
    }
    refresh(){
        this.data.contests = [];
        this.data.contestsNodeCache.clear();
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element: VJudgeInfoNode): vscode.TreeItem {
        return element;
    }
    async getChildren(element?: VJudgeInfoNode): Promise<VJudgeInfoNode[]> {
        // Root Node
        if(!element){
            return Promise.resolve([this.data.contestRootNode]);
        }

        // Contest Root Node
        if(element === this.data.contestRootNode){
            if(this.data.contests.length === 0 && this.vjudge.loggedin){
                this.data.contests = await this.vjudge.fetchContestList();
                for(const contest of this.data.contests){
                    // contest: 0->id 1->title 
                    if(!this.data.contestsNodeCache.get(contest[0])){
                        const infoNode = new VJudgeInfoNode(
                            (<string>contest[1]).trim(),
                            vscode.TreeItemCollapsibleState.Collapsed,
                        );
                        infoNode.contestId = contest[0];
                        infoNode.tooltip = 
                        `Start Time: ${new Date(contest[2]).toLocaleString()}
End Time: ${new Date(contest[3]).toLocaleString()}
Owner: ${contest[5]}`;
                        this.data.contestsNodeCache.set(contest[0], infoNode);
                    }
                }
            }
            let contestsNodeList = [];
            for(const contest of this.data.contestsNodeCache.values()){
                contestsNodeList.push(contest);
            }
            return Promise.resolve(contestsNodeList);
        }

        // Contest Node
        const problems = await this.vjudge.fetchContestProblems(element.contestId!);
        const submissions = await this.vjudge.fetchSubmissions(element.contestId!);
        // eslint-disable-next-line eqeqeq
        const filteredSubmissions = submissions.filter((submission: any) => submission[0] == this.vjudge.userId);
        let problemsNodeList = [];
        let i=0;
        for (const problem of problems) {
            const problemNode = new VJudgeInfoNode(
                `#${problem.num}. ${problem.title}`,
                vscode.TreeItemCollapsibleState.None
            );
            problemNode.contestId = element.contestId!;
            problemNode.problemNum = problem.num;
            problemNode.descriptionId = problem.publicDescId;
            problemNode.descriptionVersion = problem.publicDescVersion;
            problemNode.tooltip = `From: ${problem.oj}`;
            problemNode.description = '';
            for (const property of problem.properties) {
                problemNode.tooltip += `\n${property.title}: ${property.content}`;
                problemNode.description += ` ${property.title}: ${property.content}`;
            }
            problemNode.command = {
                command: 'vjudge-helper.openProblemDescription',
                title: 'Open Problem Description',
                arguments: [problemNode]
            };
            problemNode.contextValue = 'problem';
            let solved = -1;
            filteredSubmissions.forEach((submission: any) => {
                // eslint-disable-next-line eqeqeq
                if(submission[1] == i){
                    solved = Math.max(solved,submission[2]);
                }
            });
            let color;
            switch(solved){
                case -1:
                    color = 'grey';break;
                case 0:
                    color = 'red';break;
                default:
                    color = 'green';
            }
            problemNode.iconPath = path.join(__filename, '..', '..', 'resources', `${color}.svg`);
            problemsNodeList.push(problemNode);
            i++;
        }
        return Promise.resolve(problemsNodeList);
    }
}
export class VJudgeInfoNode extends vscode.TreeItem{
    contestId?: string;
    problemId?: string;
    problemNum?: string;
    descriptionId?: string;
    descriptionVersion?: string;
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ){
        super(label, collapsibleState);
    }
}
