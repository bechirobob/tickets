import '../../../styles/customer.css';
import '../../../styles/input-modality.css';
import '../../../styles/workspace.css';
import '../../../app/organizer/organizer.css';
import {createRoot} from 'react-dom/client';
import OrganizerSuite from '../../../app/organizer/workspace/organizer-suite';
import YorkewayAudience from '../../../app/admin/yorkeway-audience/yorkeway-audience';
const yorke=window.location.pathname.startsWith('/admin/');
createRoot(document.getElementById('root')!).render(<><p style={{margin:0,padding:'8px 16px',background:'#fff',color:'#222',font:'14px system-ui'}}>Local component preview · fictional data · no changes are saved or sent</p>{yorke?<YorkewayAudience actor="Fictional owner" role="owner"/>:<OrganizerSuite actor="Fictional organiser" role="organizer" email="host@example.test"/>}</>);
