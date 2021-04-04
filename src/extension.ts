import * as vscode from 'vscode';
import { VJudge, VJudgeInfoNode } from './vjudge';

let vjudge: VJudge; 
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "vjudge-helper" is now active!');
	vjudge = new VJudge();
	context.subscriptions.push(vscode.commands.registerCommand('vjudge-helper.login', vjudge.login));
	context.subscriptions.push(vscode.commands.registerCommand('vjudge-helper.refreshContests', () => vjudge.infoProvider.refresh()));
	context.subscriptions.push(vscode.commands.registerCommand('vjudge-helper.submitCode', async (problemNode: VJudgeInfoNode) => {
		if(!problemNode){
			vscode.window.showErrorMessage('Please click the cloud button beside the problem!');
			return;
		}
		const code = vscode.window.activeTextEditor?.document.getText();
		if(!code){
			vscode.window.showErrorMessage("Open the source code first!");
			return;
		}
		const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
			canPickMany: false,
			placeHolder: 'Are you really going to submit the current code?'
		});
		if(answer === 'No'){
			return;
		}
		vjudge.submitCode(problemNode.contestId!, problemNode.problemNum!, code);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vjudge-helper.openProblemDescription', (problemNode: VJudgeInfoNode) => {
		vjudge.openProblemDescription(
			problemNode.descriptionId!,
			problemNode.descriptionVersion!,
			problemNode.label
		);
	}));
}

export function deactivate() {}
