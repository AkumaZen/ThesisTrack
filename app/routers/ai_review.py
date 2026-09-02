from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_api_key
from app.db import get_db
from app.llm.client import LLMClient, get_llm_client
from app.schemas.proposal import ProposalOut
from app.services.ai_reviewer import AIReviewFailedError, NotFoundError, run_ai_review

router = APIRouter(prefix="/api", tags=["ai-review"], dependencies=[Depends(require_api_key)])


class AIReviewIn(BaseModel):
    period: str
    narrative: Optional[str] = None


@router.post("/companies/{company_id}/ai-review", response_model=ProposalOut)
def post_ai_review(
    company_id: str,
    payload: AIReviewIn,
    db: Session = Depends(get_db),
    llm_client: LLMClient = Depends(get_llm_client),
):
    try:
        proposal = run_ai_review(db, company_id, payload.period, payload.narrative, llm_client)
    except NotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except AIReviewFailedError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    return ProposalOut(
        id=proposal.id,
        company_id=proposal.company_id,
        period=proposal.period,
        proposed_status=proposal.proposed_status,
        source=proposal.source,
        rationale=proposal.rationale,
        evidence=proposal.evidence,
        state=proposal.state,
        model_name=proposal.model_name,
        created_at=proposal.created_at,
    )
