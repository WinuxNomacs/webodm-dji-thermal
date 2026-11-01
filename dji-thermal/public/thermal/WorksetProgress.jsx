import React from 'React';
import PropTypes from 'prop-types';
import { _, interpolate } from 'webodm/classes/gettext';
import serverApi from './serverApi';
import { POLL_MS, worksetState } from './worksetProgress';

// A DJI Thermal Task's photos being normalized or harmonized, until the task starts: in the message once the task is
// created (ThermalTaskButton) and in the task's panel after the page is refreshed (main.js). It asks the server every
// few seconds; a task without such a workset shows nothing.
export default class WorksetProgress extends React.Component {
    static propTypes = {
        projectId: PropTypes.number.isRequired,
        taskId: PropTypes.string.isRequired,
        onStarted: PropTypes.func
    };

    constructor(props){
        super(props);
        this.state = {workset: null, error: null, none: false};
    }

    componentDidMount(){
        this.poll();
    }

    componentWillUnmount(){
        this.unmounted = true;
        clearTimeout(this.timer);
    }

    poll = () => {
        serverApi.worksetProgress(this.props.projectId, this.props.taskId).then(workset => {
            if (this.unmounted) return;
            this.setState({workset, error: null});
            const state = worksetState(workset);
            if (!state.done) this.timer = setTimeout(this.poll, POLL_MS);
            else if (state.kind === "started" && this.props.onStarted) this.props.onStarted();
        }, e => {
            if (this.unmounted) return;
            if (e.status === 404) this.setState({none: true});
            else {
                this.setState({error: e.message});
                this.timer = setTimeout(this.poll, POLL_MS * 5);
            }
        });
    };

    text(state, photos){
        switch (state.kind){
        case "waiting": return interpolate(_("Waiting for WebODM's worker to convert the %(count)s photos…"), {count: photos});
        case "converting": return interpolate(_("Converting the %(count)s photos: %(progress)s…"),
                                              {count: photos, progress: state.stage || state.percent + "%"});
        case "committing": return _("Converted: putting the images in the task…");
        case "started": return _("Converted: the task is processing in WebODM.");
        case "not_started": return interpolate(_("Converted, but the task could not start: %(error)s"), {error: state.error});
        case "failed": return interpolate(_("The conversion failed: %(error)s"), {error: state.error});
        default: return _("The conversion was canceled: the task will not start.");
        }
    }

    render(){
        const { workset, error, none } = this.state;
        if (none) return "";
        if (!workset) return <div className="dji-thermal-workset-progress">{error ? interpolate(_("Cannot tell how far the conversion is: %(error)s"), {error}) : _("Asking how far the conversion is…")}</div>;
        const state = worksetState(workset);
        // Normalizing compares the frames before any is written: its stages move a full bar, with no percentage
        const staged = state.stage && !state.percent;
        return (
            <div className="dji-thermal-workset-progress">
                {state.percent !== undefined ?
                    <div className="progress">
                        <div className="progress-bar progress-bar-striped active" role="progressbar"
                             style={{width: (staged ? 100 : state.percent) + "%"}}
                             aria-valuenow={staged ? undefined : state.percent} aria-valuemin="0" aria-valuemax="100">
                            {staged ? "" : state.percent + "%"}</div>
                    </div> : ""}
                <div>{this.text(state, workset.photos)}</div>
                {error ? <div className="text-warning">{interpolate(_("Cannot tell how far the conversion is: %(error)s"), {error})}</div> : ""}
                {!state.done ? <div className="help-block">{_("You can refresh or close this page: WebODM's worker converts the photos, then starts the task.")}</div> : ""}
            </div>
        );
    }
}
