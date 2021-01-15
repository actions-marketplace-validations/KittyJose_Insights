const TerminusClient=require("@terminusdb/terminusdb-client");
const CONST=require('./constants/gitHubActions')
const axios=require('axios');
const isJson=require('./utils')


function getGitHubActionType (json) {
	if (json.action==CONST.ACTION.CREATED && json.starred_at)
		return CONST.STAR
	else if (json.action==CONST.ACTION.DELETED && json.starred_at==null)
		return CONST.UNSTAR
	else if (json.ref)
		return CONST.COMMIT
	else if (typeof json.issue=="object")
		return CONST.ISSUE
	else if (typeof json.forkee=="object")
		return CONST.FORK
}

const getQuery=(json, type)=>{
	let WOQL=TerminusClient.WOQL
	let repoID=json.repository.id,
		userID=json.sender.id

	let updateUserQuery=WOQL.and(
		WOQL.idgen("doc:GitHubUser", [userID], "v:User"),
		WOQL.update_triple("v:User", "type", "scm:GitHubUser"),
		WOQL.update_triple("v:User", "label", json.sender.login),
		WOQL.update_triple("v:User", "gitHub_user_html_url", WOQL.literal(json.sender.html_url, "xdd:url")),
		WOQL.update_triple("v:User", "gitHub_user_avatar", WOQL.literal(json.sender.avatar_url, "xdd:url"))
	)

	let updateRepoQuery=WOQL.and(
		WOQL.idgen("doc:GitHubRepo", [repoID], "v:Repo"),
		WOQL.update_triple("v:Repo", "type", "scm:GitHubRepository"),
		WOQL.update_triple("v:Repo", "label", json.repository.name),
		WOQL.update_triple("v:Repo", "gitHub_repository_html_url", WOQL.literal(json.repository.html_url, "xdd:url"))
	)

	switch(type){
		case CONST.STAR:
			return WOQL.and (
				WOQL.and(
					WOQL.idgen("doc:GitHubStar", [repoID, userID], "v:Star"),
					WOQL.add_triple("v:Star", "type", "scm:GitHubStar"),
					WOQL.update_triple("v:Star", "action", json.action),
					WOQL.update_triple("v:Star", "starred_at", WOQL.literal(json.starred_at, "xsd:dateTime"))
				),
				updateUserQuery,
				updateRepoQuery,
				WOQL.and(
					WOQL.add_triple("v:User", "gitHub_user_star", "v:Star"),
					WOQL.add_triple("v:Repo", "gitHub_repository_star", "v:Star"),
					WOQL.update_triple("v:Repo", "gitHub_stargazers_count", WOQL.literal(json.repository.stargazers_count, "xsd:integer"))
				)
			)
		case CONST.UNSTAR:
			var curr = new Date(); // unstar event doesn not have a time stamp
			var unstartedAt = curr.toISOString();
			return WOQL.and (
				WOQL.and(
					WOQL.idgen("doc:GitHubStar", [repoID, userID], "v:Star"),
					WOQL.add_triple("v:Star", "type", "scm:GitHubStar"),
					WOQL.update_triple("v:Star", "action", json.action),
					WOQL.update_triple("v:Star", "unstarred_at", WOQL.literal(unstartedAt, "xsd:dateTime"))
				),
				updateUserQuery,
				updateRepoQuery,
				WOQL.and(
					WOQL.add_triple("v:User", "gitHub_user_star", "v:Star"),
					WOQL.add_triple("v:Repo", "gitHub_repository_star", "v:Star"),
					WOQL.update_triple("v:Repo", "gitHub_stargazers_count", WOQL.literal(json.repository.stargazers_count, "xsd:integer"))
				)
			)
		case CONST.COMMIT:
			let commitID=json.after
			var q=WOQL.and(
				WOQL.and(
					WOQL.idgen("doc:GitHubCommit", [commitID], "v:Commit"),
					WOQL.add_triple("v:Commit", "type", "scm:GitHubCommit"),
					WOQL.add_triple("v:Commit", "gitHub_commit_ref", json.ref),
					WOQL.add_triple("v:Commit", "gitHub_commit_message", json.commits[0].message),
					WOQL.add_triple("v:Commit", "gitHub_commit_at", WOQL.literal(json.commits[0].timestamp, "xsd:dateTime")),
					WOQL.add_triple("v:Commit", "gitHub_commit_url", WOQL.literal(json.commits[0].url, "xdd:url"))
				),
				updateUserQuery, updateRepoQuery,
				WOQL.and(
					WOQL.add_triple("v:User", "gitHub_user_commit", "v:Commit"),
					WOQL.add_triple("v:Repo", "gitHub_repository_commit", "v:Commit")
				)
			)
			if (json.pusher.email)
				return WOQL.and(q, WOQL.update_triple("v:User", "gitHub_user_email", json.pusher.email))
			else return q
		case CONST.ISSUE:
			let issueID=json.issue.id
			var q=WOQL.and(
				WOQL.and(
					WOQL.idgen("doc:GitHubIssue", [issueID], "v:Issue"),
					WOQL.add_triple("v:Issue", "type", "scm:GitHubIssue"),
					WOQL.update_triple("v:Issue", "gitHub_issue_state", json.issue.state),
					WOQL.update_triple("v:Issue", "gitHub_issue_url", WOQL.literal(json.issue.url, "xdd:url")),
					WOQL.update_triple("v:Issue", "gitHub_issue_title", json.issue.title),
					WOQL.update_triple("v:Issue", "gitHub_issue_body", json.issue.body),
					WOQL.update_triple("v:Issue", "gitHub_issue_created_at", WOQL.literal(json.issue.created_at, "xsd:dateTime")),
					WOQL.update_triple("v:Issue", "gitHub_issue_updated_at", WOQL.literal(json.issue.updated_at, "xsd:dateTime"))
				),
				updateUserQuery, updateRepoQuery,
				WOQL.and(
					WOQL.add_triple("v:User", "gitHub_user_issue", "v:Issue"),
					WOQL.add_triple("v:Repo", "gitHub_repository_issue", "v:Issue")
				)
			)
			if (json.issue.closed_at)
				return WOQL.and(q, WOQL.update_triple("v:Issue", "gitHub_issue_closed_at", WOQL.literal(json.issue.closed_at, "xsd:dateTime")))
			else return q
		case CONST.PULL_REQUEST:
			let pullResquestID=json.pull_request.id
			var q=WOQL.and(
				WOQL.and(
					WOQL.idgen("doc:GitHubPullRequest", [issueID], "v:PullRequest"),
					WOQL.add_triple("v:PullRequest", "type", "scm:GitHubPullRequest"),
					WOQL.update_triple("v:PullRequest", "gitHub_pull_request_state", json.pull_request.state),
					WOQL.update_triple("v:PullRequest", "gitHub_pull_request_url", WOQL.literal(json.pull_request.url, "xdd:url")),
					WOQL.update_triple("v:PullRequest", "gitHub_pull_request_title", json.pull_request.title),
					WOQL.update_triple("v:PullRequest", "gitHub_pull_request_body", json.pull_request.body),
					WOQL.update_triple("v:PullRequest", "gitHub_pull_request_created_at", WOQL.literal(json.pull_request.created_at, "xsd:dateTime")),
					WOQL.update_triple("v:PullRequest", "gitHub_pull_request_updated_at", WOQL.literal(json.pull_request.updated_at, "xsd:dateTime"))
				),
				updateUserQuery, updateRepoQuery,
				WOQL.and(
					WOQL.add_triple("v:User", "gitHub_pull_request_issue", "v:PullRequest"),
					WOQL.add_triple("v:Repo", "gitHub_pull_request_issue", "v:PullRequest")
				)
			)
			if (json.pull_request.closed_at)
				return WOQL.and(q, WOQL.update_triple("v:PullRequest", "gitHub_pull_request_closed_at", WOQL.literal(json.pull_request.closed_at, "xsd:dateTime")))
			else return q
		case CONST.FORK:
			let forkID=json.forkee.id
			return WOQL.and(
				WOQL.and(
					WOQL.idgen("doc:GitHubFork", [forkID], "v:Fork"),
					WOQL.add_triple("v:Fork", "type", "scm:GitHubFork"),
					WOQL.add_triple("v:Fork", "gitHub_fork_url", WOQL.literal(json.forkee.url, "xdd:url")),
					WOQL.add_triple("v:Fork", "gitHub_fork_created_at", WOQL.literal(json.forkee.created_at, "xsd:dateTime")),
					WOQL.add_triple("v:Fork", "gitHub_fork_updated_at", WOQL.literal(json.forkee.updated_at, "xsd:dateTime")),
					WOQL.add_triple("v:Fork", "gitHub_fork_pushed_at", WOQL.literal(json.forkee.pushed_at, "xsd:dateTime"))
				),
				updateUserQuery, updateRepoQuery,
				WOQL.and(
					WOQL.add_triple("v:User", "gitHub_user_fork", "v:Fork"),
					WOQL.add_triple("v:Repo", "gitHub_repo_fork", "v:Fork")
				)
			)
	}
}

const constructQueryFromJson=(json)=>{
	let actionType=getGitHubActionType(json)
	//console.log("actionType",actionType)
	return getQuery(json, actionType)
}

function query(json){
	console.log("%%%%%%%", json)
	let q=constructQueryFromJson(json)
	console.log("************", q)
	return q
}


module.exports = query
