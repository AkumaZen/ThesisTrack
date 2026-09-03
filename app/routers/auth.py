from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import Actor, get_current_actor
from app.db import get_db
from app.schemas.auth import ChangePasswordIn, LoginIn, LoginOut, MeOut
from app.services.user_auth import InvalidCredentialsError, authenticate, change_password, issue_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    try:
        user = authenticate(db, payload.email, payload.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    return LoginOut(access_token=issue_token(user), email=user.email, role=user.role)


@router.get("/me", response_model=MeOut)
def me(actor: Actor = Depends(get_current_actor)):
    return MeOut(identity=actor.identity, role=actor.role, source=actor.source)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def post_change_password(payload: ChangePasswordIn, actor: Actor = Depends(get_current_actor), db: Session = Depends(get_db)):
    if actor.source != "user":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="only a logged-in user can change their password"
        )
    try:
        change_password(db, actor.identity, payload.old_password, payload.new_password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
