declare var document: any;
declare var window: any;
import * as vscode from 'vscode';
import * as path from 'path';
import VJudgeAPI, { Contest, ContestDetail, Problem, Solution } from '@starcatmeow/vjudge-api';
export class VJudge {
    private api: VJudgeAPI;
    public userId?: number;
    private username?: string;
    private password?: string;
    public loggedin: boolean;
    public infoProvider: VJudgeInfoProvider;
    constructor(){
        this.infoProvider = new VJudgeInfoProvider(this);
        this.loggedin = false;
        this.api = new VJudgeAPI();
    }
    login = async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Logging in...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
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
            progress.report({ increment: 50 });
            try{
                this.userId = await this.api.login(this.username, this.password);
            }catch(e){
                vscode.window.showErrorMessage(<string>e);
                this.username = undefined;
                this.password = undefined;
                return;
            }
            progress.report({ increment: 50 });
            vscode.window.showInformationMessage(`Logged in as ${this.username}(#${this.userId})!`);
            this.loggedin = true;
            this.infoProvider.register();
            return Promise.resolve();
        });
    };
    fetchContestList = async (): Promise<Contest[]> => {
        return this.api.listMyContest();
    };
    fetchContestProblems = async (contestId: number): Promise<Problem[]> => {
        return (await this.api.getContestDetail(contestId)).problems;
    };
    openProblemDescription = async (descriptionId: number, descriptionVersion: number, title: string) => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching Problem Description...',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0 });
            const html = await this.api.getProblemDescription(descriptionId, descriptionVersion);
            progress.report({ increment: 50 });
            const panel = vscode.window.createWebviewPanel('vjudge',
                title,
                vscode.ViewColumn.Two,
                {
                    enableScripts: true
                });
            panel.webview.html = html;
            progress.report({ increment: 50 });
            return Promise.resolve();
        });
    };
    submitCode = async (contestId: number, problemNum: string, code: string, language: string) => {
        let succeed = false;
        let runId = 0;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Submitting Code...',
            cancellable: true
        }, async (progress, token) => {
            progress.report({ increment: 30 });
            try {
                runId = await this.api.submitCode(contestId, problemNum, code, language);
            } catch (e) {
                console.log(e);
                vscode.window.showErrorMessage(<string>e);
                return;
            }
            progress.report({ increment: 70 });
            succeed = true;
            return Promise.resolve();
        });
        if(!succeed){
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Judge',
            cancellable: false
        }, async (progress) => {
            let solution: Partial<Solution> = {
                status: 'Pending'
            };
            while(true){
                progress.report({ message: solution.status });
                const result = await this.api.fetchSolution(runId);
                solution = result;
                if(!solution.processing){
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            if(solution.statusType === 1){
                if(solution.additionalInfo){
                    vscode.window.showErrorMessage(solution.status!, 'Show additional info').then(selection => {
                        if (selection === 'Show additional info'){
                            const panel = vscode.window.createWebviewPanel('vjudge',
                                `Submission ${runId} additional info`,
                                vscode.ViewColumn.Two);
                            panel.webview.html = solution.additionalInfo!;
                        }
                    });
                }else{
                    vscode.window.showErrorMessage(solution.status!);
                }
            }else{
                vscode.window.showInformationMessage(solution.status!);
            }
            return Promise.resolve();
        });
        //Wait for VJudge to update submission status
        setTimeout(() => {
            this.infoProvider.refresh();
        }, 15000);
    };
    fetchSubmissions = async (contestId: number) => {
        return this.api.fetchSubmissions(contestId);
    };
}
class VJudgeInfoProvider implements vscode.TreeDataProvider<VJudgeInfoNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	private registered: boolean;
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;
    data: {
        contestRootNode: VJudgeInfoNode,
        contests: Contest[],
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
                    if(!this.data.contestsNodeCache.get(contest.id)){
                        const infoNode = new VJudgeInfoNode(
                            contest.title.trim(),
                            vscode.TreeItemCollapsibleState.Collapsed,
                        );
                        infoNode.contest = contest;
                        infoNode.tooltip = 
                        `Start Time: ${contest.begin.toLocaleString()}
End Time: ${contest.end.toLocaleString()}
Owner: ${contest.managerName}`;
                        this.data.contestsNodeCache.set(contest.id, infoNode);
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
        const problems = await this.vjudge.fetchContestProblems(element.contest!.id);
        const submissions = await this.vjudge.fetchSubmissions(element.contest!.id);
        const filteredSubmissions = submissions.filter(submission => submission.submitterId === this.vjudge.userId);
        let problemsNodeList = [];
        let i=0;
        for (const problem of problems) {
            const problemNode = new VJudgeInfoNode(
                `#${problem.num}. ${problem.title}`,
                vscode.TreeItemCollapsibleState.None
            );
            problemNode.problem = problem;
            problemNode.contest = element.contest;
            problemNode.tooltip = `From: ${problem.oj} - ${problem.probNum}`;
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
            filteredSubmissions.forEach(submission => {
                if(submission.problemIndex === i){
                    solved = Math.max(solved,submission.accepted);
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
    contest?: Contest;
    contestDetail?: ContestDetail;
    problem?: Problem;
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ){
        super(label, collapsibleState);
    }
}
